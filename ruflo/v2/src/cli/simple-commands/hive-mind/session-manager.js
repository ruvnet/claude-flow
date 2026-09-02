/**
 * Hive Mind Session Manager
 * Handles session persistence and resume functionality for swarms
 */

import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import chalk from 'chalk';
import { cwd } from '../../node-compat.js';
import { createDatabase, isSQLiteAvailable, isWindows } from '../../../memory/sqlite-wrapper.js';
import { sessionSerializer } from '../../../memory/enhanced-session-serializer.js';
import { SerializationError, DeserializationError } from '../../../memory/advanced-serializer.js';

export class HiveMindSessionManager {
  constructor(hiveMindDir = null) {
    this.hiveMindDir = hiveMindDir || path.join(cwd(), '.hive-mind');
    this.sessionsDir = path.join(this.hiveMindDir, 'sessions');
    this.dbPath = path.join(this.hiveMindDir, 'hive.db');
    this.db = null;
    this.isInMemory = false;
    this.memoryStore = null;
    this.initializationPromise = null;

    // Ensure directories exist
    this.ensureDirectories();

    // Initialize database connection (store promise for later)
    this.initializationPromise = this.initializeDatabase();
  }

  /**
   * Initialize database with fallback support
   */
  async initializeDatabase() {
    try {
      const sqliteAvailable = await isSQLiteAvailable();
      
      if (!sqliteAvailable) {
        console.warn('SQLite not available, using in-memory session storage');
        this.initializeInMemoryFallback();
        return;
      }

      this.db = await createDatabase(this.dbPath);
      if (this.db) {
        this.initializeSchema();
      } else {
        throw new Error('Failed to create database instance');
      }
    } catch (error) {
      console.error('Failed to create SQLite database:', error.message);
      console.warn('Falling back to in-memory session storage');
      this.initializeInMemoryFallback();
    }
  }

  /**
   * Ensure database is initialized before use
   */
  async ensureInitialized() {
    if (this.initializationPromise) {
      await this.initializationPromise;
      this.initializationPromise = null;
    }
    
    if (this.db === null && !this.isInMemory) {
      await this.initializeDatabase();
    }
  }

  /**
   * Initialize in-memory fallback for session storage
   */
  initializeInMemoryFallback() {
    this.isInMemory = true;
    this.memoryStore = {
      sessions: new Map(),
      checkpoints: new Map(),
      logs: new Map()
    };
    
    if (isWindows()) {
      console.info(`
Note: Session data will not persist between runs on Windows without SQLite.
To enable persistence, see: https://github.com/ruvnet/claude-code-flow/docs/windows-installation.md
`);
    }
  }

  /**
   * Ensure required directories exist
   */
  ensureDirectories() {
    if (!existsSync(this.hiveMindDir)) {
      mkdirSync(this.hiveMindDir, { recursive: true });
    }
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Initialize database schema for sessions
   */
  initializeSchema() {
    if (!this.db) {
      console.error('Database not initialized');
      return;
    }
    // Create the base schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        swarm_name TEXT NOT NULL,
        objective TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paused_at DATETIME,
        resumed_at DATETIME,
        completion_percentage REAL DEFAULT 0,
        checkpoint_data TEXT,
        metadata TEXT,
        parent_pid INTEGER,
        child_pids TEXT,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      );

      CREATE TABLE IF NOT EXISTS session_checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        checkpoint_name TEXT NOT NULL,
        checkpoint_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS session_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        log_level TEXT DEFAULT 'info',
        message TEXT,
        agent_id TEXT,
        data TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
    `);

    // Run migrations to add new columns
    this.runMigrations();
  }

  /**
   * Run database migrations
   */
  runMigrations() {
    if (!this.db) {
      console.error('Database not initialized for migrations');
      return;
    }
    try {
      // Check if required columns exist
      const columns = this.db.prepare('PRAGMA table_info(sessions)').all();
      
      // Core columns
      const hasObjective = columns.some((col) => col.name === 'objective');
      const hasSwarmName = columns.some((col) => col.name === 'swarm_name');
      const hasCheckpointData = columns.some((col) => col.name === 'checkpoint_data');
      const hasMetadata = columns.some((col) => col.name === 'metadata');
      const hasParentPid = columns.some((col) => col.name === 'parent_pid');
      const hasChildPids = columns.some((col) => col.name === 'child_pids');
      
      // Timestamp columns
      const hasUpdatedAt = columns.some((col) => col.name === 'updated_at');
      const hasPausedAt = columns.some((col) => col.name === 'paused_at');
      const hasResumedAt = columns.some((col) => col.name === 'resumed_at');
      const hasCompletionPercentage = columns.some((col) => col.name === 'completion_percentage');

      if (!hasObjective) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN objective TEXT');
        console.log('Added objective column to sessions table');
      }

      if (!hasSwarmName) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN swarm_name TEXT');
        console.log('Added swarm_name column to sessions table');
      }

      if (!hasCheckpointData) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN checkpoint_data TEXT');
        console.log('Added checkpoint_data column to sessions table');
      }

      if (!hasMetadata) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN metadata TEXT');
        console.log('Added metadata column to sessions table');
      }

      if (!hasParentPid) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN parent_pid INTEGER');
        console.log('Added parent_pid column to sessions table');
      }

      if (!hasChildPids) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN child_pids TEXT');
        console.log('Added child_pids column to sessions table');
      }

      if (!hasUpdatedAt) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
        console.log('Added updated_at column to sessions table');
      }

      if (!hasPausedAt) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN paused_at DATETIME');
        console.log('Added paused_at column to sessions table');
      }

      if (!hasResumedAt) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN resumed_at DATETIME');
        console.log('Added resumed_at column to sessions table');
      }

      if (!hasCompletionPercentage) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN completion_percentage REAL DEFAULT 0');
        console.log('Added completion_percentage column to sessions table');
      }
    } catch (error) {
      console.error('Migration error:', error);
    }
  }

  /**
   * Create a new session for a swarm
   */
  async createSession(swarmId, swarmName, objective, metadata = {}) {
    await this.ensureInitialized();
    
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    if (this.isInMemory) {
      // Use in-memory storage
      const sessionData = {
        id: sessionId,
        swarm_id: swarmId,
        swarm_name: swarmName,
        objective,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: sessionSerializer.serializeMetadata(metadata),
        parent_pid: process.pid,
        child_pids: '[]'
      };
      this.memoryStore.sessions.set(sessionId, sessionData);
    } else {
      // Use SQLite
      const stmt = this.db.prepare(`
        INSERT INTO sessions (id, swarm_id, swarm_name, objective, metadata, parent_pid)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(sessionId, swarmId, swarmName, objective, sessionSerializer.serializeMetadata(metadata), process.pid);
    }

    // Log session creation
    await this.logSessionEvent(sessionId, 'info', 'Session created', null, {
      swarmId,
      swarmName,
      objective,
      parentPid: process.pid,
    });

    return sessionId;
  }

  /**
   * Save session checkpoint
   */
  async saveCheckpoint(sessionId, checkpointName, checkpointData) {
    await this.ensureInitialized();
    
    const checkpointId = `checkpoint-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    if (this.isInMemory) {
      // Use in-memory storage
      const checkpointEntry = {
        id: checkpointId,
        session_id: sessionId,
        checkpoint_name: checkpointName,
        checkpoint_data: sessionSerializer.serializeCheckpointData(checkpointData),
        created_at: new Date().toISOString()
      };
      
      if (!this.memoryStore.checkpoints.has(sessionId)) {
        this.memoryStore.checkpoints.set(sessionId, []);
      }
      this.memoryStore.checkpoints.get(sessionId).push(checkpointEntry);
      
      // Update session data
      const session = this.memoryStore.sessions.get(sessionId);
      if (session) {
        session.checkpoint_data = sessionSerializer.serializeCheckpointData(checkpointData);
        session.updated_at = new Date().toISOString();
      }
    } else {
      // Save to database
      const stmt = this.db.prepare(`
        INSERT INTO session_checkpoints (id, session_id, checkpoint_name, checkpoint_data)
        VALUES (?, ?, ?, ?)
      `);

      stmt.run(checkpointId, sessionId, checkpointName, sessionSerializer.serializeCheckpointData(checkpointData));

      // Update session checkpoint data and timestamp
      const updateStmt = this.db.prepare(`
        UPDATE sessions 
        SET checkpoint_data = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      updateStmt.run(sessionSerializer.serializeCheckpointData(checkpointData), sessionId);
    }

    // Save checkpoint file for backup
    const checkpointFile = path.join(this.sessionsDir, `${sessionId}-${checkpointName}.json`);
    await writeFile(
      checkpointFile,
      sessionSerializer.serializeSessionData({
        sessionId,
        checkpointId,
        checkpointName,
        timestamp: new Date().toISOString(),
        data: checkpointData,
      }),
    );

    await this.logSessionEvent(sessionId, 'info', `Checkpoint saved: ${checkpointName}`, null, {
      checkpointId,
    });

    return checkpointId;
  }

  /**
   * Get active sessions
   */
  async getActiveSessions() {
    await this.ensureInitialized();
    
    if (this.isInMemory) {
      // Use in-memory storage with real counts
      const sessions = [];
      for (const [sessionId, session] of this.memoryStore.sessions) {
        if (session.status === 'active' || session.status === 'paused') {
          // Get real agent count from memory
          const agentCount = this.memoryStore.agents 
            ? Array.from(this.memoryStore.agents.values()).filter(a => a.swarm_id === session.swarm_id).length 
            : 0;
          
          // Get real task counts from memory
          const tasks = this.memoryStore.tasks 
            ? Array.from(this.memoryStore.tasks.values()).filter(t => t.swarm_id === session.swarm_id)
            : [];
          
          const taskCount = tasks.length;
          const completedTasks = tasks.filter(t => t.status === 'completed').length;
          const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
          const pendingTasks = tasks.filter(t => t.status === 'pending').length;
          
          sessions.push({
            ...session,
            metadata: session.metadata ? sessionSerializer.deserializeMetadata(session.metadata) : {},
            checkpoint_data: session.checkpoint_data ? sessionSerializer.deserializeCheckpointData(session.checkpoint_data) : null,
            agent_count: agentCount,
            task_count: taskCount,
            completed_tasks: completedTasks,
            in_progress_tasks: inProgressTasks,
            pending_tasks: pendingTasks,
            completion_percentage: taskCount > 0 ? Math.round((completedTasks / taskCount) * 100) : 0
          });
        }
      }
      return sessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    } else {
      // Use SQLite
      const stmt = this.db.prepare(`
        SELECT s.*, 
               COUNT(DISTINCT a.id) as agent_count,
               COUNT(DISTINCT t.id) as task_count,
               SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks
        FROM sessions s
        LEFT JOIN agents a ON s.swarm_id = a.swarm_id
        LEFT JOIN tasks t ON s.swarm_id = t.swarm_id
        WHERE s.status = 'active' OR s.status = 'paused'
        GROUP BY s.id
        ORDER BY s.updated_at DESC
      `);

      const sessions = stmt.all();

      // Parse JSON fields
      return sessions.map((session) => ({
        ...session,
        metadata: session.metadata ? sessionSerializer.deserializeMetadata(session.metadata) : {},
        checkpoint_data: session.checkpoint_data ? sessionSerializer.deserializeCheckpointData(session.checkpoint_data) : null,
        completion_percentage:
          session.task_count > 0
            ? Math.round((session.completed_tasks / session.task_count) * 100)
            : 0,
      }));
    }
  }

  /**
   * Get session by ID with full details
   */
  async getSession(sessionId) {
    await this.ensureInitialized();
    
    if (this.isInMemory) {
      // Use in-memory storage
      const session = this.memoryStore.sessions.get(sessionId);
      if (!session) {
        return null;
      }
      
      // Return simplified session data for in-memory mode
      return {
        ...session,
        metadata: session.metadata ? sessionSerializer.deserializeMetadata(session.metadata) : {},
        checkpoint_data: session.checkpoint_data ? sessionSerializer.deserializeCheckpointData(session.checkpoint_data) : null,
        swarm: null, // Not available in memory mode
        agents: [], // Not available in memory mode
        tasks: [], // Not available in memory mode
        checkpoints: this.memoryStore.checkpoints.get(sessionId) || [],
        recentLogs: this.memoryStore.logs.get(sessionId) || [],
        statistics: {
          totalAgents: 0,
          activeAgents: 0,
          totalTasks: 0,
          completedTasks: 0,
          pendingTasks: 0,
          inProgressTasks: 0,
          completionPercentage: session.completion_percentage || 0,
        },
      };
    }

    const session = this.db
      .prepare(
        `
      SELECT * FROM sessions WHERE id = ?
    `,
      )
      .get(sessionId);

    if (!session) {
      return null;
    }

    // Get associated swarm data
    const swarm = this.db
      .prepare(
        `
      SELECT * FROM swarms WHERE id = ?
    `,
      )
      .get(session.swarm_id);

    // Get agents
    const agents = this.db
      .prepare(
        `
      SELECT * FROM agents WHERE swarm_id = ?
    `,
      )
      .all(session.swarm_id);

    // Get tasks
    const tasks = this.db
      .prepare(
        `
      SELECT * FROM tasks WHERE swarm_id = ?
    `,
      )
      .all(session.swarm_id);

    // Get checkpoints
    const checkpoints = this.db
      .prepare(
        `
      SELECT * FROM session_checkpoints 
      WHERE session_id = ? 
      ORDER BY created_at DESC
    `,
      )
      .all(sessionId);

    // Get recent logs
    const recentLogs = this.db
      .prepare(
        `
      SELECT * FROM session_logs 
      WHERE session_id = ? 
      ORDER BY timestamp DESC 
      LIMIT 50
    `,
      )
      .all(sessionId);

    return {
      ...session,
      metadata: session.metadata ? sessionSerializer.deserializeMetadata(session.metadata) : {},
      checkpoint_data: session.checkpoint_data ? sessionSerializer.deserializeCheckpointData(session.checkpoint_data) : null,
      swarm,
      agents,
      tasks,
      checkpoints: checkpoints.map((cp) => ({
        ...cp,
        checkpoint_data: sessionSerializer.deserializeCheckpointData(cp.checkpoint_data),
      })),
      recentLogs,
      statistics: {
        totalAgents: agents.length,
        activeAgents: agents.filter((a) => a.status === 'active' || a.status === 'busy').length,
        totalTasks: tasks.length,
        completedTasks: tasks.filter((t) => t.status === 'completed').length,
        pendingTasks: tasks.filter((t) => t.status === 'pending').length,
        inProgressTasks: tasks.filter((t) => t.status === 'in_progress').length,
        completionPercentage:
          tasks.length > 0
            ? Math.round(
                (tasks.filter((t) => t.status === 'completed').length / tasks.length) * 100,
              )
            : 0,
      },
    };
  }

  /**
   * Pause a session
   */
  async pauseSession(sessionId) {
    await this.ensureInitialized();
    
    if (this.isInMemory) {
      // Use in-memory storage
      const session = this.memoryStore.sessions.get(sessionId);
      if (session) {
        session.status = 'paused';
        session.paused_at = new Date().toISOString();
        session.updated_at = new Date().toISOString();
        
        await this.logSessionEvent(sessionId, 'info', 'Session paused');
        return true;
      }
      return false;
    } else {
      // Use SQLite
      const stmt = this.db.prepare(`
        UPDATE sessions 
        SET status = 'paused', paused_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      const result = stmt.run(sessionId);

      if (result.changes > 0) {
        await this.logSessionEvent(sessionId, 'info', 'Session paused');

        // Update swarm status
        const session = this.db.prepare('SELECT swarm_id FROM sessions WHERE id = ?').get(sessionId);
        if (session) {
          this.db
            .prepare('UPDATE swarms SET status = ? WHERE id = ?')
            .run('paused', session.swarm_id);
        }
      }

      return result.changes > 0;
    }
  }

  /**
   * Resume any previous session (paused, stopped, or inactive)
   */
  async resumeSession(sessionId) {
    const session = await this.getSession(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Allow resuming any session regardless of status
    console.log(`Resuming session ${sessionId} from status: ${session.status}`);

    // If session was stopped, log that we're restarting it
    if (session.status === 'stopped') {
      await this.logSessionEvent(
        sessionId,
        'info',
        `Restarting stopped session with original configuration`,
      );
    }

    // Update session status
    if (this.isInMemory) {
      // Use in-memory storage
      const sessionData = this.memoryStore.sessions.get(sessionId);
      if (sessionData) {
        sessionData.status = 'active';
        sessionData.resumed_at = new Date().toISOString();
        sessionData.updated_at = new Date().toISOString();
      }
    } else {
      // Use SQLite
      const stmt = this.db.prepare(`
        UPDATE sessions 
        SET status = 'active', resumed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      stmt.run(sessionId);

      // Update swarm status
      this.db.prepare('UPDATE swarms SET status = ? WHERE id = ?').run('active', session.swarm_id);

      // Update agent statuses
      this.db
        .prepare(
          `
        UPDATE agents 
        SET status = CASE 
          WHEN role = 'queen' THEN 'active'
          ELSE 'idle'
        END
        WHERE swarm_id = ?
      `,
        )
        .run(session.swarm_id);
    }

    await this.logSessionEvent(sessionId, 'info', 'Session resumed', null, {
      pausedDuration: session.paused_at ? new Date() - new Date(session.paused_at) : null,
    });

    return session;
  }

  /**
   * Mark session as completed
   */
  async completeSession(sessionId) {
    await this.ensureInitialized();
    
    if (this.isInMemory) {
      // Use in-memory storage
      const session = this.memoryStore.sessions.get(sessionId);
      if (session) {
        session.status = 'completed';
        session.updated_at = new Date().toISOString();
        session.completion_percentage = 100;
        
        await this.logSessionEvent(sessionId, 'info', 'Session completed');
        return true;
      }
      return false;
    } else {
      // Use SQLite
      const stmt = this.db.prepare(`
        UPDATE sessions 
        SET status = 'completed', updated_at = CURRENT_TIMESTAMP, completion_percentage = 100
        WHERE id = ?
      `);

      const result = stmt.run(sessionId);

      if (result.changes > 0) {
        await this.logSessionEvent(sessionId, 'info', 'Session completed');

        // Update swarm status
        const session = this.db.prepare('SELECT swarm_id FROM sessions WHERE id = ?').get(sessionId);
        if (session) {
          this.db
            .prepare('UPDATE swarms SET status = ? WHERE id = ?')
            .run('completed', session.swarm_id);
        }
      }

      return result.changes > 0;
    }
  }

  /**
   * Archive old sessions
   */
  async archiveSessions(daysOld = 30) {
    await this.ensureInitialized();
    
    if (this.isInMemory) {
      // In-memory mode doesn't support archiving
      console.warn('Session archiving not supported in in-memory mode');
      return 0;
    }
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const sessionsToArchive = this.db
      .prepare(
        `
      SELECT * FROM sessions 
      WHERE status = 'completed' AND updated_at < ?
    `,
      )
      .all(cutoffDate.toISOString());

    const archiveDir = path.join(this.sessionsDir, 'archive');
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
    }

    for (const session of sessionsToArchive) {
      const sessionData = await this.getSession(session.id);
      const archiveFile = path.join(archiveDir, `${session.id}-archive.json`);

      await writeFile(archiveFile, sessionSerializer.serializeSessionData(sessionData));

      // Remove from database
      this.db.prepare('DELETE FROM session_logs WHERE session_id = ?').run(session.id);
      this.db.prepare('DELETE FROM session_checkpoints WHERE session_id = ?').run(session.id);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    }

    return sessionsToArchive.length;
  }

  /**
   * Log session event
   */
  async logSessionEvent(sessionId, logLevel, message, agentId = null, data = null) {
    await this.ensureInitialized();
    
    if (this.isInMemory) {
      // Use in-memory storage for logs
      const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      const logEntry = {
        id: logId,
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        log_level: logLevel,
        message,
        agent_id: agentId,
        data: data ? sessionSerializer.serializeLogData(data) : null
      };
      
      if (!this.memoryStore.logs.has(sessionId)) {
        this.memoryStore.logs.set(sessionId, []);
      }
      this.memoryStore.logs.get(sessionId).push(logEntry);
    } else {
      // Use SQLite
      const stmt = this.db.prepare(`
        INSERT INTO session_logs (session_id, log_level, message, agent_id, data)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(sessionId, logLevel, message, agentId, data ? sessionSerializer.serializeLogData(data) : null);
    }
  }

  /**
   * Get session logs
   */
  async getSessionLogs(sessionId, limit = 100, offset = 0) {
    await this.ensureInitialized();
    
    if (this.isInMemory) {
      // Use in-memory storage
      const logs = this.memoryStore.logs.get(sessionId) || [];
      return logs.slice(offset, offset + limit).map((log) => ({
        ...log,
        data: log.data ? sessionSerializer.deserializeLogData(log.data) : null,
      }));
    }
    
    const stmt = this.db.prepare(`
      SELECT * FROM session_logs 
      WHERE session_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ? OFFSET ?
    `);

    const logs = stmt.all(sessionId, limit, offset);

    return logs.map((log) => ({
      ...log,
      data: log.data ? sessionSerializer.deserializeLogData(log.data) : null,
    }));
  }

  /**
   * Update session progress
   */
  async updateSessionProgress(sessionId, completionPercentage) {
    await this.ensureInitialized();
    
    if (this.isInMemory) {
      // Use in-memory storage
      const session = this.memoryStore.sessions.get(sessionId);
      if (session) {
        session.completion_percentage = completionPercentage;
        session.updated_at = new Date().toISOString();
      }
    } else {
      // Use SQLite
      const stmt = this.db.prepare(`
        UPDATE sessions 
        SET completion_percentage = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      stmt.run(completionPercentage, sessionId);
    }
  }

  /**
   * Generate session summary
   */
  async generateSessionSummary(sessionId) {
    const session = await this.getSession(sessionId);

    if (!session) {
      return null;
    }

    const duration =
      session.paused_at && session.resumed_at
        ? new Date(session.updated_at) -
          new Date(session.created_at) -
          (new Date(session.resumed_at) - new Date(session.paused_at))
        : new Date(session.updated_at) - new Date(session.created_at);

    const tasksByType = session.agents.reduce((acc, agent) => {
      const agentTasks = session.tasks.filter((t) => t.agent_id === agent.id);
      if (!acc[agent.type]) {
        acc[agent.type] = {
          total: 0,
          completed: 0,
          inProgress: 0,
          pending: 0,
        };
      }
      acc[agent.type].total += agentTasks.length;
      acc[agent.type].completed += agentTasks.filter((t) => t.status === 'completed').length;
      acc[agent.type].inProgress += agentTasks.filter((t) => t.status === 'in_progress').length;
      acc[agent.type].pending += agentTasks.filter((t) => t.status === 'pending').length;
      return acc;
    }, {});

    return {
      sessionId: session.id,
      swarmName: session.swarm_name,
      objective: session.objective,
      status: session.status,
      duration: Math.round(duration / 1000 / 60), // minutes
      statistics: session.statistics,
      tasksByType,
      checkpointCount: session.checkpoints.length,
      lastCheckpoint: session.checkpoints[0] || null,
      timeline: {
        created: session.created_at,
        lastUpdated: session.updated_at,
        paused: session.paused_at,
        resumed: session.resumed_at,
      },
    };
  }

  /**
   * Export session data
   */
  async exportSession(sessionId, exportPath = null) {
    const session = await this.getSession(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const exportFile = exportPath || path.join(this.sessionsDir, `${sessionId}-export.json`);

    await writeFile(exportFile, sessionSerializer.serializeSessionData(session));

    return exportFile;
  }

  /**
   * Import session data
   */
  async importSession(importPath) {
    const sessionData = sessionSerializer.deserializeSessionData(await readFile(importPath, 'utf8'));

    // Create new session with imported data
    const newSessionId = this.createSession(
      sessionData.swarm_id,
      sessionData.swarm_name,
      sessionData.objective,
      sessionData.metadata,
    );

    // Import checkpoints
    for (const checkpoint of sessionData.checkpoints || []) {
      await this.saveCheckpoint(
        newSessionId,
        checkpoint.checkpoint_name,
        checkpoint.checkpoint_data,
      );
    }

    // Import logs
    for (const log of sessionData.recentLogs || []) {
      await this.logSessionEvent(
        newSessionId,
        log.log_level,
        log.message,
        log.agent_id,
        log.data ? sessionSerializer.deserializeLogData(log.data) : null,
      );
    }

    return newSessionId;
  }

  /**
   * Add a child process PID to session
   */
  async addChildPid(sessionId, pid) {
    await this.ensureInitialized();
    
    if (this.isInMemory) {
      // Use in-memory storage
      const session = this.memoryStore.sessions.get(sessionId);
      if (!session) return false;
      
      const childPids = session.child_pids ? sessionSerializer.deserializeLogData(session.child_pids) : [];
      if (!childPids.includes(pid)) {
        childPids.push(pid);
      }
      session.child_pids = sessionSerializer.serializeLogData(childPids);
      session.updated_at = new Date().toISOString();
      
      await this.logSessionEvent(sessionId, 'info', 'Child process added', null, { pid });
      return true;
    }
    
    const session = this.db.prepare('SELECT child_pids FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return false;

    const childPids = session.child_pids ? sessionSerializer.deserializeLogData(session.child_pids) : [];
    if (!childPids.includes(pid)) {
      childPids.push(pid);
    }

    const stmt = this.db.prepare(`
      UPDATE sessions 
      SET child_pids = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(sessionSerializer.serializeLogData(childPids), sessionId);

    await this.logSessionEvent(sessionId, 'info', 'Child process added', null, { pid });
    return true;
  }

  /**
   * Remove a child process PID from session
   */
  async removeChildPid(sessionId, pid) {
    await this.ensureInitialized();
    
    if (this.isInMemory) {
      // Use in-memory storage
      const session = this.memoryStore.sessions.get(sessionId);
      if (!session) return false;
      
      const childPids = session.child_pids ? sessionSerializer.deserializeLogData(session.child_pids) : [];
      const index = childPids.indexOf(pid);
      if (index > -1) {
        childPids.splice(index, 1);
      }
      session.child_pids = sessionSerializer.serializeLogData(childPids);
      session.updated_at = new Date().toISOString();
      
      await this.logSessionEvent(sessionId, 'info', 'Child process removed', null, { pid });
      return true;
    }
    
    // Check if database connection is still open before operations
    if (!this.db || !this.db.open) {
      console.warn('Database connection closed, cannot remove child PID during cleanup');
      return false;
    }
    
    const session = this.db.prepare('SELECT child_pids FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return false;

    const childPids = session.child_pids ? sessionSerializer.deserializeLogData(session.child_pids) : [];
    const index = childPids.indexOf(pid);
    if (index > -1) {
      childPids.splice(index, 1);
    }

    const stmt = this.db.prepare(`
      UPDATE sessions 
      SET child_pids = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(sessionSerializer.serializeLogData(childPids), sessionId);

    await this.logSessionEvent(sessionId, 'info', 'Child process removed', null, { pid });
    return true;
  }

  /**
   * Get all child PIDs for a session
   */
  async getChildPids(sessionId) {
    await this.ensureInitialized();
    
    if (this.isInMemory) {
      // Use in-memory storage
      const session = this.memoryStore.sessions.get(sessionId);
      if (!session || !session.child_pids) return [];
      return sessionSerializer.deserializeLogData(session.child_pids);
    } else {
      // Check if database connection is still open
      if (!this.db || !this.db.open) {
        console.warn('Database connection closed, cannot get child PIDs during cleanup');
        return [];
      }
      
      // Use SQLite
      const session = this.db.prepare('SELECT child_pids FROM sessions WHERE id = ?').get(sessionId);
      if (!session || !session.child_pids) return [];
      return sessionSerializer.deserializeLogData(session.child_pids);
    }
  }

  /**
   * Stop a session and terminate all child processes
   */
  async stopSession(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Get child PIDs
    const childPids = await this.getChildPids(sessionId);

    // Terminate child processes
    for (const pid of childPids) {
      try {
        process.kill(pid, 'SIGTERM');
        await this.logSessionEvent(sessionId, 'info', 'Child process terminated', null, { pid });
      } catch (err) {
        // Process might already be dead
        await this.logSessionEvent(sessionId, 'warning', 'Failed to terminate child process', null, {
          pid,
          error: err.message,
        });
      }
    }

    // Update session status
    if (this.isInMemory) {
      // Use in-memory storage
      const sessionData = this.memoryStore.sessions.get(sessionId);
      if (sessionData) {
        sessionData.status = 'stopped';
        sessionData.updated_at = new Date().toISOString();
      }
    } else {
      // Use SQLite
      const stmt = this.db.prepare(`
        UPDATE sessions 
        SET status = 'stopped', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      stmt.run(sessionId);

      // Update swarm status
      this.db.prepare('UPDATE swarms SET status = ? WHERE id = ?').run('stopped', session.swarm_id);
    }

    await this.logSessionEvent(sessionId, 'info', 'Session stopped');

    return true;
  }

  /**
   * Get active sessions with process information
   */
  async getActiveSessionsWithProcessInfo() {
    const sessions = await this.getActiveSessions();

    // Add process info to each session
    return sessions.map((session) => {
      const childPids = session.child_pids ? sessionSerializer.deserializeLogData(session.child_pids) : [];
      const aliveChildPids = [];

      // Check which child processes are still alive
      for (const pid of childPids) {
        try {
          process.kill(pid, 0); // Signal 0 just checks if process exists
          aliveChildPids.push(pid);
        } catch (err) {
          // Process is dead
        }
      }

      return {
        ...session,
        parent_pid: session.parent_pid,
        child_pids: aliveChildPids,
        total_processes: 1 + aliveChildPids.length,
      };
    });
  }

  /**
   * Clean up orphaned processes
   */
  async cleanupOrphanedProcesses() {
    await this.ensureInitialized();
    
    if (this.isInMemory) {
      // In-memory mode doesn't track orphaned processes
      return 0;
    }
    
    const sessions = this.db
      .prepare(
        `
      SELECT * FROM sessions 
      WHERE status IN ('active', 'paused')
    `,
      )
      .all();

    let cleanedCount = 0;

    for (const session of sessions) {
      // Check if parent process is still alive
      try {
        process.kill(session.parent_pid, 0);
      } catch (err) {
        // Parent is dead, clean up session
        await this.stopSession(session.id);
        cleanedCount++;
        await this.logSessionEvent(session.id, 'info', 'Orphaned session cleaned up');
      }
    }

    return cleanedCount;
  }

  /**
   * Clean up and close database connection
   */
  close() {
    if (this.db && !this.isInMemory) {
      this.db.close();
    }
  }
}

// Export for use in other modules
export default HiveMindSessionManager;
