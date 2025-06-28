/**
 * Persistence layer for Claude-Flow using SQLite
 */

import Database from "better-sqlite3";
import { join } from "path";
import { mkdir } from "fs/promises";

export interface PersistedAgent {
  id: string;
  type: string;
  name: string;
  status: string;
  capabilities: string;
  systemPrompt: string;
  maxConcurrentTasks: number;
  priority: number;
  createdAt: number;
}

export interface PersistedTask {
  id: string;
  type: string;
  description: string;
  status: string;
  priority: number;
  dependencies: string;
  metadata: string;
  assignedAgent?: string;
  progress: number;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export class PersistenceManager {
  private db!: Database.Database; // Initialized in initialize()
  private dbPath: string;

  constructor(dataDir: string = "./memory") {
    this.dbPath = join(dataDir, "claude-flow.db");
  }

  async initialize(): Promise<void> {
    // Ensure directory exists
    await mkdir(join(this.dbPath, ".."), { recursive: true });
    
    // Open database
    this.db = new Database(this.dbPath);
    
    // Create tables if they don't exist
    this.createTables();
  }

  private createTables(): void {
    // Agents table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        max_concurrent_tasks INTEGER NOT NULL,
        priority INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Tasks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        dependencies TEXT NOT NULL,
        metadata TEXT NOT NULL,
        assigned_agent TEXT,
        progress INTEGER DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);

    // Sessions table for terminal sessions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      )
    `);
  }

  // Agent operations
  async saveAgent(agent: PersistedAgent): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO agents 
       (id, type, name, status, capabilities, system_prompt, max_concurrent_tasks, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      agent.id,
      agent.type,
      agent.name,
      agent.status,
      agent.capabilities,
      agent.systemPrompt,
      agent.maxConcurrentTasks,
      agent.priority,
      agent.createdAt
    );
  }

  async getAgent(id: string): Promise<PersistedAgent | null> {
    const stmt = this.db.prepare("SELECT * FROM agents WHERE id = ?");
    const row = stmt.get(id) as any;
    
    if (!row) return null;
    
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      status: row.status,
      capabilities: row.capabilities,
      systemPrompt: row.system_prompt,
      maxConcurrentTasks: row.max_concurrent_tasks,
      priority: row.priority,
      createdAt: row.created_at,
    };
  }

  async getActiveAgents(): Promise<PersistedAgent[]> {
    const stmt = this.db.prepare("SELECT * FROM agents WHERE status IN ('active', 'idle') ORDER BY created_at DESC");
    const rows = stmt.all() as any[];
    
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      name: row.name,
      status: row.status,
      capabilities: row.capabilities,
      systemPrompt: row.system_prompt,
      maxConcurrentTasks: row.max_concurrent_tasks,
      priority: row.priority,
      createdAt: row.created_at,
    }));
  }

  async updateAgentStatus(id: string, status: string): Promise<void> {
    const stmt = this.db.prepare("UPDATE agents SET status = ? WHERE id = ?");
    stmt.run(status, id);
  }

  // Task operations
  async saveTask(task: PersistedTask): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO tasks 
       (id, type, description, status, priority, dependencies, metadata, assigned_agent, progress, error, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      task.id,
      task.type,
      task.description,
      task.status,
      task.priority,
      task.dependencies,
      task.metadata,
      task.assignedAgent || null,
      task.progress,
      task.error || null,
      task.createdAt,
      task.completedAt || null
    );
  }

  async getTask(id: string): Promise<PersistedTask | null> {
    const stmt = this.db.prepare("SELECT * FROM tasks WHERE id = ?");
    const row = stmt.get(id) as any;
    
    if (!row) return null;
    
    return {
      id: row.id,
      type: row.type,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dependencies: row.dependencies,
      metadata: row.metadata,
      assignedAgent: row.assigned_agent || undefined,
      progress: row.progress,
      error: row.error || undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at || undefined,
    };
  }

  async getActiveTasks(): Promise<PersistedTask[]> {
    const stmt = this.db.prepare("SELECT * FROM tasks WHERE status IN ('pending', 'in_progress', 'assigned') ORDER BY priority DESC, created_at ASC");
    const rows = stmt.all() as any[];
    
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dependencies: row.dependencies,
      metadata: row.metadata,
      assignedAgent: row.assigned_agent || undefined,
      progress: row.progress,
      error: row.error || undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at || undefined,
    }));
  }

  async updateTaskStatus(id: string, status: string, assignedAgent?: string): Promise<void> {
    if (assignedAgent) {
      const stmt = this.db.prepare("UPDATE tasks SET status = ?, assigned_agent = ? WHERE id = ?");
      stmt.run(status, assignedAgent, id);
    } else {
      const stmt = this.db.prepare("UPDATE tasks SET status = ? WHERE id = ?");
      stmt.run(status, id);
    }
  }

  async updateTaskProgress(id: string, progress: number): Promise<void> {
    const stmt = this.db.prepare("UPDATE tasks SET progress = ? WHERE id = ?");
    stmt.run(progress, id);
  }

  // Statistics
  async getStats(): Promise<{
    totalAgents: number;
    activeAgents: number;
    totalTasks: number;
    pendingTasks: number;
    completedTasks: number;
  }> {
    const totalAgents = this.db.prepare("SELECT COUNT(*) as count FROM agents").get() as any;
    const activeAgents = this.db.prepare("SELECT COUNT(*) as count FROM agents WHERE status IN ('active', 'idle')").get() as any;
    const totalTasks = this.db.prepare("SELECT COUNT(*) as count FROM tasks").get() as any;
    const pendingTasks = this.db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status IN ('pending', 'in_progress', 'assigned')").get() as any;
    const completedTasks = this.db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'completed'").get() as any;
    
    return {
      totalAgents: totalAgents.count,
      activeAgents: activeAgents.count,
      totalTasks: totalTasks.count,
      pendingTasks: pendingTasks.count,
      completedTasks: completedTasks.count,
    };
  }

  close(): void {
    this.db.close();
  }
}