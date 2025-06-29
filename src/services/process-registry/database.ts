/**
 * SQLite Database Interface for Process Registry
 * 
 * Handles all database operations for the process registry
 */

import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ProcessInfo, ProcessFilter, HealthStatus, ProcessMetrics } from './types.js';
import { Logger } from '../../core/logger';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = Logger.getInstance().child({ component: 'ProcessRegistryDB' });

export class ProcessRegistryDatabase {
  private db: Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string = join(process.cwd(), '.claude-flow', 'registry.db')) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    try {
      // Open database connection
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      // Enable foreign keys
      await this.db.run('PRAGMA foreign_keys = ON');

      // Initialize schema
      const schemaPath = join(__dirname, 'schema.sql');
      const schema = await readFile(schemaPath, 'utf-8');
      await this.db.exec(schema);

      logger.info('Process registry database initialized', { dbPath: this.dbPath });
    } catch (error) {
      logger.error('Failed to initialize database', { error });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  // Process operations
  async insertProcess(process: ProcessInfo): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = `
      INSERT INTO processes (
        id, name, type, pid, parent_id, start_time, status,
        command, environment, resources, health_check, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.db.run(sql, [
      process.id,
      process.name,
      process.type,
      process.pid,
      process.parentId || null,
      process.startTime.getTime(),
      process.status,
      JSON.stringify(process.command),
      JSON.stringify(process.environment),
      JSON.stringify(process.resources),
      JSON.stringify(process.healthCheck),
      process.metadata ? JSON.stringify(process.metadata) : null
    ]);
  }

  // Alias for insertProcess to maintain compatibility
  async register(process: ProcessInfo): Promise<void> {
    return this.insertProcess(process);
  }

  async updateProcess(processId: string, updates: Partial<ProcessInfo>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.resources !== undefined) {
      fields.push('resources = ?');
      values.push(JSON.stringify(updates.resources));
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length === 0) return;

    values.push(processId);
    const sql = `UPDATE processes SET ${fields.join(', ')} WHERE id = ?`;
    await this.db.run(sql, values);
  }

  async deleteProcess(processId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.run('DELETE FROM processes WHERE id = ?', [processId]);
  }

  async getProcess(processId: string): Promise<ProcessInfo | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = await this.db.get(
      'SELECT * FROM processes WHERE id = ?',
      [processId]
    );

    return row ? this.rowToProcessInfo(row) : null;
  }

  async queryProcesses(filter: ProcessFilter): Promise<ProcessInfo[]> {
    if (!this.db) throw new Error('Database not initialized');

    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.id) {
      conditions.push('id = ?');
      params.push(filter.id);
    }
    if (filter.name) {
      conditions.push('name LIKE ?');
      params.push(`%${filter.name}%`);
    }
    if (filter.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter.parentId) {
      conditions.push('parent_id = ?');
      params.push(filter.parentId);
    }
    if (filter.since) {
      conditions.push('start_time >= ?');
      params.push(filter.since.getTime());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM processes ${whereClause} ORDER BY start_time DESC`;

    const rows = await this.db.all(sql, params);
    return rows.map(row => this.rowToProcessInfo(row));
  }

  // Health operations
  async insertHealthCheck(processId: string, status: HealthStatus): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = `
      INSERT INTO health_checks (
        process_id, timestamp, status, consecutive_failures, diagnostics
      ) VALUES (?, ?, ?, ?, ?)
    `;

    await this.db.run(sql, [
      processId,
      status.lastHeartbeat.getTime(),
      status.status,
      status.consecutiveFailures,
      status.diagnostics ? JSON.stringify(status.diagnostics) : null
    ]);
  }

  async getLatestHealthCheck(processId: string): Promise<HealthStatus | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = await this.db.get(
      'SELECT * FROM health_checks WHERE process_id = ? ORDER BY timestamp DESC LIMIT 1',
      [processId]
    );

    if (!row) return null;

    return {
      processId: row.process_id,
      status: row.status,
      lastHeartbeat: new Date(row.timestamp),
      consecutiveFailures: row.consecutive_failures,
      diagnostics: row.diagnostics ? JSON.parse(row.diagnostics) : undefined
    };
  }

  // Metrics operations
  async insertMetrics(metrics: ProcessMetrics): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = `
      INSERT INTO process_metrics (
        process_id, timestamp, memory, cpu, uptime, error_count
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;

    await this.db.run(sql, [
      metrics.processId,
      metrics.timestamp.getTime(),
      metrics.memory,
      metrics.cpu,
      metrics.uptime,
      metrics.errorCount
    ]);
  }

  // Event logging
  async logEvent(processId: string | null, eventType: string, details?: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = `
      INSERT INTO registry_events (
        process_id, event_type, timestamp, details
      ) VALUES (?, ?, ?, ?)
    `;

    await this.db.run(sql, [
      processId,
      eventType,
      Date.now(),
      details ? JSON.stringify(details) : null
    ]);
  }

  // Utility methods
  private rowToProcessInfo(row: any): ProcessInfo {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      pid: row.pid,
      parentId: row.parent_id,
      startTime: new Date(row.start_time),
      status: row.status,
      command: JSON.parse(row.command),
      environment: JSON.parse(row.environment),
      resources: JSON.parse(row.resources),
      healthCheck: JSON.parse(row.health_check),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };
  }

  // Cleanup operations
  async cleanupOldHealthChecks(daysToKeep: number = 7): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    await this.db.run('DELETE FROM health_checks WHERE timestamp < ?', [cutoffTime]);
  }

  async cleanupOldMetrics(daysToKeep: number = 7): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    await this.db.run('DELETE FROM process_metrics WHERE timestamp < ?', [cutoffTime]);
  }

  async cleanupOldEvents(daysToKeep: number = 30): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    await this.db.run('DELETE FROM registry_events WHERE timestamp < ?', [cutoffTime]);
  }
}