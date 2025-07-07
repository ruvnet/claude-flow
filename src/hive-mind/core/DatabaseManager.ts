/**
 * DatabaseManager Class
 * 
 * Manages all database operations for the Hive Mind system
 * using SQLite as the persistence layer.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';

// ES module compatibility - define __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DatabaseManager extends EventEmitter {
  private static instance: DatabaseManager;
  private db: Database.Database;
  private statements: Map<string, Database.Statement>;
  private dbPath: string;

  private constructor() {
    super();
    this.statements = new Map();
  }

  /**
   * Get singleton instance
   */
  static async getInstance(): Promise<DatabaseManager> {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
      await DatabaseManager.instance.initialize();
    }
    return DatabaseManager.instance;
  }

  /**
   * Initialize database
   */
  async initialize(): Promise<void> {
    // Ensure data directory exists
    const dataDir = path.join(process.cwd(), 'data');
    await fs.mkdir(dataDir, { recursive: true });
    
    // Set database path
    this.dbPath = path.join(dataDir, 'hive-mind.db');
    
    // Open database
    this.db = new Database(this.dbPath);
    
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
    
    // Load schema
    await this.loadSchema();
    
    // Prepare statements
    this.prepareStatements();
    
    this.emit('initialized');
  }

  /**
   * Load database schema
   */
  private async loadSchema(): Promise<void> {
    const schemaPath = path.join(__dirname, '..', '..', 'db', 'hive-mind-schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');
    
    // Execute schema
    this.db.exec(schema);
  }

  /**
   * Prepare common SQL statements
   */
  private prepareStatements(): void {
    // Swarm statements
    this.statements.set('createSwarm', this.db.prepare(`
      INSERT INTO swarms (id, name, topology, queen_mode, max_agents, consensus_threshold, memory_ttl, config)
      VALUES (@id, @name, @topology, @queenMode, @maxAgents, @consensusThreshold, @memoryTTL, @config)
    `));
    
    this.statements.set('getSwarm', this.db.prepare(`
      SELECT * FROM swarms WHERE id = ?
    `));
    
    this.statements.set('getActiveSwarm', this.db.prepare(`
      SELECT id FROM swarms WHERE is_active = 1 LIMIT 1
    `));
    
    this.statements.set('setActiveSwarm', this.db.prepare(`
      UPDATE swarms SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END
    `));
    
    // Agent statements
    this.statements.set('createAgent', this.db.prepare(`
      INSERT INTO agents (id, swarm_id, name, type, status, capabilities, metadata)
      VALUES (@id, @swarmId, @name, @type, @status, @capabilities, @metadata)
    `));
    
    this.statements.set('getAgent', this.db.prepare(`
      SELECT * FROM agents WHERE id = ?
    `));
    
    this.statements.set('getAgents', this.db.prepare(`
      SELECT * FROM agents WHERE swarm_id = ?
    `));
    
    this.statements.set('updateAgent', this.db.prepare(`
      UPDATE agents SET ? WHERE id = ?
    `));
    
    // Task statements
    this.statements.set('createTask', this.db.prepare(`
      INSERT INTO tasks (
        id, swarm_id, description, priority, strategy, status, 
        dependencies, assigned_agents, require_consensus, max_agents, 
        required_capabilities, metadata
      ) VALUES (
        @id, @swarmId, @description, @priority, @strategy, @status,
        @dependencies, @assignedAgents, @requireConsensus, @maxAgents,
        @requiredCapabilities, @metadata
      )
    `));
    
    this.statements.set('getTask', this.db.prepare(`
      SELECT * FROM tasks WHERE id = ?
    `));
    
    this.statements.set('getTasks', this.db.prepare(`
      SELECT * FROM tasks WHERE swarm_id = ? ORDER BY created_at DESC
    `));
    
    this.statements.set('updateTaskStatus', this.db.prepare(`
      UPDATE tasks SET status = ? WHERE id = ?
    `));
    
    // Memory statements
    this.statements.set('storeMemory', this.db.prepare(`
      INSERT OR REPLACE INTO memory (key, namespace, value, ttl, metadata)
      VALUES (@key, @namespace, @value, @ttl, @metadata)
    `));
    
    this.statements.set('getMemory', this.db.prepare(`
      SELECT * FROM memory WHERE key = ? AND namespace = ?
    `));
    
    this.statements.set('searchMemory', this.db.prepare(`
      SELECT * FROM memory 
      WHERE namespace = ? AND (key LIKE ? OR value LIKE ?)
      ORDER BY last_accessed_at DESC
      LIMIT ?
    `));
    
    // Communication statements
    this.statements.set('createCommunication', this.db.prepare(`
      INSERT INTO communications (
        from_agent_id, to_agent_id, swarm_id, message_type, 
        content, priority, requires_response
      ) VALUES (
        @from_agent_id, @to_agent_id, @swarm_id, @message_type,
        @content, @priority, @requires_response
      )
    `));
    
    // Performance statements
    this.statements.set('storeMetric', this.db.prepare(`
      INSERT INTO performance_metrics (swarm_id, agent_id, metric_type, metric_value, metadata)
      VALUES (@swarm_id, @agent_id, @metric_type, @metric_value, @metadata)
    `));
  }

  /**
   * Raw SQL helper for complex updates
   */
  raw(sql: string): any {
    return { _raw: sql };
  }

  // Swarm operations

  async createSwarm(data: any): Promise<void> {
    this.statements.get('createSwarm')!.run(data);
  }

  async getSwarm(id: string): Promise<any> {
    return this.statements.get('getSwarm')!.get(id);
  }

  async getActiveSwarmId(): Promise<string | null> {
    const result = this.statements.get('getActiveSwarm')!.get();
    return result ? result.id : null;
  }

  async setActiveSwarm(id: string): Promise<void> {
    this.statements.get('setActiveSwarm')!.run(id);
  }

  async getAllSwarms(): Promise<any[]> {
    return this.db.prepare(`
      SELECT s.*, COUNT(a.id) as agentCount 
      FROM swarms s 
      LEFT JOIN agents a ON s.id = a.swarm_id 
      GROUP BY s.id 
      ORDER BY s.created_at DESC
    `).all();
  }

  // Agent operations

  async createAgent(data: any): Promise<void> {
    this.statements.get('createAgent')!.run(data);
  }

  async getAgent(id: string): Promise<any> {
    return this.statements.get('getAgent')!.get(id);
  }

  async getAgents(swarmId: string): Promise<any[]> {
    return this.statements.get('getAgents')!.all(swarmId);
  }

  async updateAgent(id: string, updates: any): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (value && typeof value === 'object' && value._raw) {
        setClauses.push(`${key} = ${value._raw}`);
      } else {
        setClauses.push(`${key} = ?`);
        values.push(value);
      }
    }
    
    values.push(id);
    
    const stmt = this.db.prepare(`
      UPDATE agents SET ${setClauses.join(', ')} WHERE id = ?
    `);
    
    stmt.run(...values);
  }

  async updateAgentStatus(id: string, status: string): Promise<void> {
    this.db.prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, id);
  }

  async getAgentPerformance(agentId: string): Promise<any> {
    const agent = await this.getAgent(agentId);
    if (!agent) return null;
    
    return {
      successRate: agent.success_count / (agent.success_count + agent.error_count) || 0,
      totalTasks: agent.success_count + agent.error_count,
      messageCount: agent.message_count
    };
  }

  // Task operations

  async createTask(data: any): Promise<void> {
    this.statements.get('createTask')!.run({
      ...data,
      requireConsensus: data.requireConsensus ? 1 : 0
    });
  }

  async getTask(id: string): Promise<any> {
    return this.statements.get('getTask')!.get(id);
  }

  async getTasks(swarmId: string): Promise<any[]> {
    return this.statements.get('getTasks')!.all(swarmId);
  }

  async updateTask(id: string, updates: any): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];
    
    for (const [key, value] of Object.entries(updates)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
    
    values.push(id);
    
    const stmt = this.db.prepare(`
      UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?
    `);
    
    stmt.run(...values);
  }

  async updateTaskStatus(id: string, status: string): Promise<void> {
    this.statements.get('updateTaskStatus')!.run(status, id);
  }

  async getPendingTasks(swarmId: string): Promise<any[]> {
    return this.db.prepare(`
      SELECT * FROM tasks 
      WHERE swarm_id = ? AND status = 'pending'
      ORDER BY 
        CASE priority 
          WHEN 'critical' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          WHEN 'low' THEN 4 
        END,
        created_at ASC
    `).all(swarmId);
  }

  async getActiveTasks(swarmId: string): Promise<any[]> {
    return this.db.prepare(`
      SELECT * FROM tasks 
      WHERE swarm_id = ? AND status IN ('assigned', 'in_progress')
    `).all(swarmId);
  }

  async reassignTask(taskId: string, newAgentId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) return;
    
    const assignedAgents = JSON.parse(task.assigned_agents || '[]');
    if (!assignedAgents.includes(newAgentId)) {
      assignedAgents.push(newAgentId);
    }
    
    await this.updateTask(taskId, {
      assigned_agents: JSON.stringify(assignedAgents)
    });
  }

  // Memory operations

  async storeMemory(data: any): Promise<void> {
    this.statements.get('storeMemory')!.run(data);
  }

  async getMemory(key: string, namespace: string): Promise<any> {
    return this.statements.get('getMemory')!.get(key, namespace);
  }

  async updateMemoryAccess(key: string, namespace: string): Promise<void> {
    this.db.prepare(`
      UPDATE memory 
      SET access_count = access_count + 1, last_accessed_at = CURRENT_TIMESTAMP
      WHERE key = ? AND namespace = ?
    `).run(key, namespace);
  }

  async searchMemory(options: any): Promise<any[]> {
    const pattern = `%${options.pattern || ''}%`;
    return this.statements.get('searchMemory')!.all(
      options.namespace || 'default',
      pattern,
      pattern,
      options.limit || 10
    );
  }

  async deleteMemory(key: string, namespace: string): Promise<void> {
    this.db.prepare('DELETE FROM memory WHERE key = ? AND namespace = ?').run(key, namespace);
  }

  async listMemory(namespace: string, limit: number): Promise<any[]> {
    return this.db.prepare(`
      SELECT * FROM memory 
      WHERE namespace = ? 
      ORDER BY last_accessed_at DESC 
      LIMIT ?
    `).all(namespace, limit);
  }

  async getMemoryStats(): Promise<any> {
    const result = this.db.prepare(`
      SELECT 
        COUNT(*) as totalEntries,
        SUM(LENGTH(value)) as totalSize
      FROM memory
    `).get();
    
    return result || { totalEntries: 0, totalSize: 0 };
  }

  async getNamespaceStats(namespace: string): Promise<any> {
    return this.db.prepare(`
      SELECT 
        COUNT(*) as entries,
        SUM(LENGTH(value)) as size,
        AVG(ttl) as avgTTL
      FROM memory
      WHERE namespace = ?
    `).get(namespace) || { entries: 0, size: 0, avgTTL: 0 };
  }

  async getAllMemoryEntries(): Promise<any[]> {
    return this.db.prepare('SELECT * FROM memory').all();
  }

  async getRecentMemoryEntries(limit: number): Promise<any[]> {
    return this.db.prepare(`
      SELECT * FROM memory 
      ORDER BY last_accessed_at DESC 
      LIMIT ?
    `).all(limit);
  }

  async getOldMemoryEntries(daysOld: number): Promise<any[]> {
    return this.db.prepare(`
      SELECT * FROM memory 
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `).all(daysOld);
  }

  async updateMemoryEntry(entry: any): Promise<void> {
    this.db.prepare(`
      UPDATE memory 
      SET value = ?, access_count = ?, last_accessed_at = ?
      WHERE key = ? AND namespace = ?
    `).run(
      entry.value,
      entry.accessCount,
      entry.lastAccessedAt,
      entry.key,
      entry.namespace
    );
  }

  async clearMemory(swarmId: string): Promise<void> {
    // Clear memory related to a specific swarm
    this.db.prepare(`
      DELETE FROM memory 
      WHERE metadata LIKE '%"swarmId":"${swarmId}"%'
    `).run();
  }

  async deleteOldEntries(namespace: string, ttl: number): Promise<void> {
    this.db.prepare(`
      DELETE FROM memory 
      WHERE namespace = ? AND created_at < datetime('now', '-' || ? || ' seconds')
    `).run(namespace, ttl);
  }

  async trimNamespace(namespace: string, maxEntries: number): Promise<void> {
    this.db.prepare(`
      DELETE FROM memory 
      WHERE namespace = ? AND key NOT IN (
        SELECT key FROM memory 
        WHERE namespace = ? 
        ORDER BY last_accessed_at DESC 
        LIMIT ?
      )
    `).run(namespace, namespace, maxEntries);
  }

  // Communication operations

  async createCommunication(data: any): Promise<void> {
    this.statements.get('createCommunication')!.run(data);
  }

  async getPendingMessages(agentId: string): Promise<any[]> {
    return this.db.prepare(`
      SELECT * FROM communications 
      WHERE to_agent_id = ? AND delivered_at IS NULL
      ORDER BY 
        CASE priority 
          WHEN 'urgent' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'normal' THEN 3 
          WHEN 'low' THEN 4 
        END,
        timestamp ASC
    `).all(agentId);
  }

  async markMessageDelivered(messageId: string): Promise<void> {
    this.db.prepare(`
      UPDATE communications 
      SET delivered_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(messageId);
  }

  async markMessageRead(messageId: string): Promise<void> {
    this.db.prepare(`
      UPDATE communications 
      SET read_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(messageId);
  }

  async getRecentMessages(swarmId: string, timeWindow: number): Promise<any[]> {
    return this.db.prepare(`
      SELECT * FROM communications 
      WHERE swarm_id = ? AND timestamp > datetime('now', '-' || ? || ' milliseconds')
    `).all(swarmId, timeWindow);
  }

  // Consensus operations

  async createConsensusProposal(proposal: any): Promise<void> {
    this.db.prepare(`
      INSERT INTO consensus (
        id, swarm_id, task_id, proposal, required_threshold, 
        status, deadline_at
      ) VALUES (
        @id, @swarmId, @taskId, @proposal, @requiredThreshold,
        'pending', @deadline
      )
    `).run({
      id: proposal.id,
      swarmId: proposal.swarmId,
      taskId: proposal.taskId || null,
      proposal: JSON.stringify(proposal.proposal),
      requiredThreshold: proposal.requiredThreshold,
      deadline: proposal.deadline
    });
  }

  async submitConsensusVote(proposalId: string, agentId: string, vote: boolean, reason?: string): Promise<void> {
    const proposal = this.db.prepare('SELECT * FROM consensus WHERE id = ?').get(proposalId);
    if (!proposal) return;
    
    const votes = JSON.parse(proposal.votes || '{}');
    votes[agentId] = { vote, reason: reason || '', timestamp: new Date() };
    
    const totalVoters = Object.keys(votes).length;
    const positiveVotes = Object.values(votes).filter((v: any) => v.vote).length;
    const currentRatio = positiveVotes / totalVoters;
    
    const status = currentRatio >= proposal.required_threshold ? 'achieved' : 'pending';
    
    this.db.prepare(`
      UPDATE consensus 
      SET votes = ?, current_votes = ?, total_voters = ?, status = ?
      WHERE id = ?
    `).run(
      JSON.stringify(votes),
      positiveVotes,
      totalVoters,
      status,
      proposalId
    );
  }

  // Performance operations

  async storePerformanceMetric(data: any): Promise<void> {
    this.statements.get('storeMetric')!.run({
      ...data,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null
    });
  }

  async getSwarmStats(swarmId: string): Promise<any> {
    const agentStats = this.db.prepare(`
      SELECT 
        COUNT(*) as agentCount,
        SUM(CASE WHEN status = 'busy' THEN 1 ELSE 0 END) as busyAgents
      FROM agents 
      WHERE swarm_id = ?
    `).get(swarmId);
    
    const taskStats = this.db.prepare(`
      SELECT 
        COUNT(*) as taskBacklog
      FROM tasks 
      WHERE swarm_id = ? AND status IN ('pending', 'assigned')
    `).get(swarmId);
    
    return {
      ...agentStats,
      ...taskStats,
      agentUtilization: agentStats.agentCount > 0 
        ? agentStats.busyAgents / agentStats.agentCount 
        : 0
    };
  }

  async getStrategyPerformance(swarmId: string): Promise<any> {
    const results = this.db.prepare(`
      SELECT 
        strategy,
        COUNT(*) as totalTasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
        AVG(JULIANDAY(completed_at) - JULIANDAY(created_at)) * 24 * 60 * 60 * 1000 as avgCompletionTime
      FROM tasks 
      WHERE swarm_id = ? AND completed_at IS NOT NULL
      GROUP BY strategy
    `).all(swarmId);
    
    const performance: any = {};
    for (const result of results) {
      performance[result.strategy] = {
        successRate: result.successful / result.totalTasks,
        avgCompletionTime: result.avgCompletionTime,
        totalTasks: result.totalTasks
      };
    }
    
    return performance;
  }

  async getSuccessfulDecisions(swarmId: string): Promise<any[]> {
    return this.db.prepare(`
      SELECT * FROM memory 
      WHERE namespace = 'queen-decisions' 
      AND key LIKE 'decision/%'
      AND metadata LIKE '%"swarmId":"${swarmId}"%'
      ORDER BY created_at DESC
      LIMIT 100
    `).all();
  }

  // Utility operations

  async deleteMemoryEntry(key: string, namespace: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.db.prepare('DELETE FROM memory WHERE key = ? AND namespace = ?').run(key, namespace);
      
      const duration = Date.now() - startTime;
      this.recordPerformance('delete_memory', duration);
      
    } catch (error) {
      this.recordPerformance('delete_memory_error', Date.now() - startTime);
      throw error;
    }
  }

  /**
   * Get database analytics
   */
  getDatabaseAnalytics(): any {
    try {
      const stats = this.db.prepare('PRAGMA table_info(swarms)').all();
      return {
        fragmentation: 0, // Placeholder - could implement actual fragmentation detection
        tableCount: stats.length,
        schemaVersion: '1.0.0'
      };
    } catch (error) {
      return {
        fragmentation: 0,
        tableCount: 0,
        schemaVersion: 'unknown'
      };
    }
  }

  /**
   * Record performance metric
   */
  private recordPerformance(operation: string, duration: number): void {
    // Simple performance tracking - could be expanded
    console.debug(`DB Operation ${operation}: ${duration.toFixed(2)}ms`);
  }

  // Additional Consensus operations

  async getConsensusProposal(id: string): Promise<any> {
    return this.db.prepare('SELECT * FROM consensus WHERE id = ?').get(id);
  }

  async updateConsensusStatus(id: string, status: string): Promise<void> {
    this.db.prepare('UPDATE consensus SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, id);
  }

  async getRecentConsensusProposals(limit: number): Promise<any[]> {
    return this.db.prepare('SELECT * FROM consensus ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}