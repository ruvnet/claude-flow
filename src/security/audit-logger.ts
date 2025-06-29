/**
 * Comprehensive audit logging system for security compliance
 */

import { createWriteStream, WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { ILogger } from '../core/logger.js';

export interface AuditEvent {
  timestamp: Date;
  eventType: AuditEventType;
  userId?: string;
  sessionId?: string;
  resource?: string;
  action: string;
  outcome: 'success' | 'failure' | 'error';
  details?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  errorMessage?: string;
}

export enum AuditEventType {
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  PROCESS_SPAWN = 'PROCESS_SPAWN',
  PROCESS_TERMINATE = 'PROCESS_TERMINATE',
  CONFIG_CHANGE = 'CONFIG_CHANGE',
  DATA_ACCESS = 'DATA_ACCESS',
  DATA_MODIFICATION = 'DATA_MODIFICATION',
  COMMAND_EXECUTION = 'COMMAND_EXECUTION',
  SYSTEM_ACCESS = 'SYSTEM_ACCESS',
  SECURITY_VIOLATION = 'SECURITY_VIOLATION',
}

export interface IAuditLogger {
  log(event: AuditEvent): Promise<void>;
  query(filter: AuditFilter): Promise<AuditEvent[]>;
  rotate(): Promise<void>;
}

export interface AuditFilter {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  eventType?: AuditEventType;
  outcome?: 'success' | 'failure' | 'error';
  limit?: number;
}

export class AuditLogger implements IAuditLogger {
  private logStream?: WriteStream;
  private logPath: string;
  private events: AuditEvent[] = [];
  private maxInMemoryEvents = 10000;

  constructor(
    private config: {
      logDir: string;
      rotationInterval?: number; // milliseconds
      retentionDays?: number;
      enableConsoleLog?: boolean;
    },
    private logger: ILogger,
  ) {
    this.logPath = join(config.logDir, `audit-${new Date().toISOString().split('T')[0]}.log`);
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Ensure log directory exists
      await mkdir(dirname(this.logPath), { recursive: true });

      // Create write stream
      this.logStream = createWriteStream(this.logPath, {
        flags: 'a',
        encoding: 'utf8',
      });

      // Set up rotation if configured
      if (this.config.rotationInterval) {
        setInterval(() => {
          this.rotate().catch((error) => {
            this.logger.error('Failed to rotate audit log', error);
          });
        }, this.config.rotationInterval);
      }

      this.logger.info('Audit logger initialized', { logPath: this.logPath });
    } catch (error) {
      this.logger.error('Failed to initialize audit logger', error);
      throw error;
    }
  }

  async log(event: AuditEvent): Promise<void> {
    // Add to in-memory buffer
    this.events.push(event);
    if (this.events.length > this.maxInMemoryEvents) {
      this.events.shift(); // Remove oldest
    }

    // Format event for logging
    const logEntry = this.formatEvent(event);

    // Write to file
    if (this.logStream && !this.logStream.destroyed) {
      await new Promise<void>((resolve, reject) => {
        this.logStream!.write(logEntry + '\n', (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    // Console logging for critical events
    if (this.config.enableConsoleLog || event.outcome === 'error' || event.eventType === AuditEventType.SECURITY_VIOLATION) {
      this.logger.warn('Audit event', {
        type: event.eventType,
        action: event.action,
        outcome: event.outcome,
        user: event.userId,
      });
    }
  }

  async query(filter: AuditFilter): Promise<AuditEvent[]> {
    let results = [...this.events];

    // Apply filters
    if (filter.startDate) {
      results = results.filter((e) => e.timestamp >= filter.startDate!);
    }

    if (filter.endDate) {
      results = results.filter((e) => e.timestamp <= filter.endDate!);
    }

    if (filter.userId) {
      results = results.filter((e) => e.userId === filter.userId);
    }

    if (filter.eventType) {
      results = results.filter((e) => e.eventType === filter.eventType);
    }

    if (filter.outcome) {
      results = results.filter((e) => e.outcome === filter.outcome);
    }

    // Apply limit
    if (filter.limit && filter.limit > 0) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  async rotate(): Promise<void> {
    if (!this.logStream || this.logStream.destroyed) {
      return;
    }

    // Close current stream
    await new Promise<void>((resolve) => {
      this.logStream!.end(() => resolve());
    });

    // Create new log file
    this.logPath = join(this.config.logDir, `audit-${new Date().toISOString().split('T')[0]}.log`);
    this.logStream = createWriteStream(this.logPath, {
      flags: 'a',
      encoding: 'utf8',
    });

    this.logger.info('Audit log rotated', { newPath: this.logPath });

    // Clean up old logs if retention is set
    if (this.config.retentionDays) {
      await this.cleanupOldLogs();
    }
  }

  private formatEvent(event: AuditEvent): string {
    const formatted = {
      timestamp: event.timestamp.toISOString(),
      eventType: event.eventType,
      userId: event.userId || 'anonymous',
      sessionId: event.sessionId || 'none',
      resource: event.resource || 'none',
      action: event.action,
      outcome: event.outcome,
      ip: event.ip || 'unknown',
      userAgent: event.userAgent || 'unknown',
      details: event.details || {},
      errorMessage: event.errorMessage,
    };

    return JSON.stringify(formatted);
  }

  private async cleanupOldLogs(): Promise<void> {
    // Implementation for cleaning up logs older than retention period
    // This would scan the log directory and remove old files
    this.logger.debug('Cleaning up old audit logs');
  }
}

/**
 * Audit logger factory with singleton pattern
 */
let auditLoggerInstance: AuditLogger | null = null;

export function createAuditLogger(
  config: {
    logDir: string;
    rotationInterval?: number;
    retentionDays?: number;
    enableConsoleLog?: boolean;
  },
  logger: ILogger,
): IAuditLogger {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new AuditLogger(config, logger);
  }
  return auditLoggerInstance;
}

/**
 * Helper functions for common audit scenarios
 */
export const AuditHelpers = {
  logAuthentication: async (
    auditLogger: IAuditLogger,
    userId: string,
    success: boolean,
    details?: Record<string, unknown>,
  ): Promise<void> => {
    await auditLogger.log({
      timestamp: new Date(),
      eventType: AuditEventType.AUTHENTICATION,
      userId,
      action: 'login',
      outcome: success ? 'success' : 'failure',
      ...(details !== undefined && { details }),
    });
  },

  logAuthorization: async (
    auditLogger: IAuditLogger,
    userId: string,
    resource: string,
    permission: string,
    granted: boolean,
  ): Promise<void> => {
    await auditLogger.log({
      timestamp: new Date(),
      eventType: AuditEventType.AUTHORIZATION,
      userId,
      resource,
      action: `check_permission:${permission}`,
      outcome: granted ? 'success' : 'failure',
      details: { permission, granted },
    });
  },

  logProcessSpawn: async (
    auditLogger: IAuditLogger,
    userId: string,
    processType: string,
    processId: string,
    success: boolean,
    error?: string,
  ): Promise<void> => {
    await auditLogger.log({
      timestamp: new Date(),
      eventType: AuditEventType.PROCESS_SPAWN,
      userId,
      resource: processId,
      action: `spawn:${processType}`,
      outcome: success ? 'success' : 'failure',
      ...(error !== undefined && { errorMessage: error }),
      details: { processType, processId },
    });
  },

  logCommandExecution: async (
    auditLogger: IAuditLogger,
    userId: string,
    command: string,
    args: string[],
    success: boolean,
    error?: string,
  ): Promise<void> => {
    await auditLogger.log({
      timestamp: new Date(),
      eventType: AuditEventType.COMMAND_EXECUTION,
      userId,
      action: command,
      outcome: success ? 'success' : 'failure',
      ...(error !== undefined && { errorMessage: error }),
      details: { command, args },
    });
  },

  logSecurityViolation: async (
    auditLogger: IAuditLogger,
    userId: string,
    violation: string,
    details?: Record<string, unknown>,
  ): Promise<void> => {
    await auditLogger.log({
      timestamp: new Date(),
      eventType: AuditEventType.SECURITY_VIOLATION,
      userId,
      action: violation,
      outcome: 'error',
      ...(details !== undefined && { details }),
    });
  },
};