/**
 * Secure orchestrator wrapper with integrated security controls
 */

import { join } from 'path';
import { 
  IOrchestrator, 
  ISessionManager 
} from './orchestrator.js';
import {
  Config,
  AgentProfile,
  Task,
  HealthStatus,
  OrchestratorMetrics,
  SecurityConfig,
} from '../utils/types.js';
import { ILogger } from './logger.js';
import { 
  ISecurityMiddleware,
  SecurityContext,
  createSecurityMiddleware,
  DefaultSecurityConfig,
  AuditEventType,
  SecurityError,
} from '../security/index.js';

export interface SecureOrchestratorConfig extends Omit<Config, 'security'> {
  security?: SecurityConfig & {
    enabled: boolean;
    requireAuth?: boolean;
    enforceWhitelist?: boolean;
    auditAll?: boolean;
  };
}

export class SecureOrchestrator implements IOrchestrator {
  private security: ISecurityMiddleware;
  private currentContext?: SecurityContext;

  constructor(
    private orchestrator: IOrchestrator,
    private logger: ILogger,
    private config: SecureOrchestratorConfig,
  ) {
    // Initialize security middleware with config
    const securityConfig = {
      ...DefaultSecurityConfig,
      authentication: {
        ...DefaultSecurityConfig.authentication,
        enabled: config.security?.enabled ?? true,
      },
      audit: {
        ...DefaultSecurityConfig.audit,
        enabled: config.security?.auditAll ?? true,
        logDir: config.orchestrator?.dataDir 
          ? join(config.orchestrator.dataDir, 'audit') 
          : './data/audit',
      },
    };

    this.security = createSecurityMiddleware(securityConfig, logger);

    logger.info('Secure orchestrator initialized', {
      securityEnabled: config.security?.enabled,
      requireAuth: config.security?.requireAuth,
      enforceWhitelist: config.security?.enforceWhitelist,
    });
  }

  /**
   * Set the current security context for operations
   */
  setSecurityContext(context: SecurityContext): void {
    this.currentContext = context;
  }

  /**
   * Authenticate with the security middleware
   */
  async authenticate(credentials: { token?: string; username?: string; password?: string }): Promise<{
    success: boolean;
    context?: SecurityContext;
    error?: string;
  }> {
    try {
      const result = await this.security.authenticate(credentials);
      if (result.success && result.context) {
        this.currentContext = result.context;
      }
      return result;
    } catch (error) {
      this.logger.error('Authentication failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed'
      };
    }
  }

  /**
   * Get current security context or throw if not authenticated
   */
  private getContext(): SecurityContext {
    if (!this.currentContext && this.config.security?.requireAuth) {
      throw new SecurityError(
        'Authentication required',
        'AUTH_FAILED',
        { operation: 'getContext' }
      );
    }
    return this.currentContext || { userId: 'system' };
  }

  async initialize(): Promise<void> {
    const context = this.getContext();
    
    // Check authorization
    const authorized = await this.security.authorize(context, 'system', 'initialize');
    if (!authorized) {
      throw new SecurityError(
        'Unauthorized to initialize system',
        'UNAUTHORIZED',
        { userId: context.userId, operation: 'initialize' }
      );
    }

    // Log initialization attempt
    await this.security.auditLog(
      AuditEventType.SYSTEM_ACCESS,
      context,
      {
        action: 'initialize',
        timestamp: new Date(),
      }
    );

    // Perform actual initialization
    return this.orchestrator.initialize();
  }

  async shutdown(): Promise<void> {
    const context = this.getContext();
    
    // Check authorization
    const authorized = await this.security.authorize(context, 'system', 'shutdown');
    if (!authorized) {
      throw new SecurityError(
        'Unauthorized to shutdown system',
        'UNAUTHORIZED',
        { userId: context.userId, operation: 'shutdown' }
      );
    }

    // Log shutdown attempt
    await this.security.auditLog(
      AuditEventType.SYSTEM_ACCESS,
      context,
      {
        action: 'shutdown',
        timestamp: new Date(),
      }
    );

    return this.orchestrator.shutdown();
  }

  async spawnAgent(profile: AgentProfile): Promise<string> {
    const context = this.getContext();
    
    // Validate agent profile
    const validation = await this.security.validateInput('command', profile.type);
    if (!validation.valid) {
      throw new SecurityError(
        `Invalid agent type: ${validation.error}`,
        'INVALID_INPUT',
        { agentType: profile.type }
      );
    }

    // Check authorization
    const authorized = await this.security.authorize(context, 'agents', 'spawn');
    if (!authorized) {
      throw new SecurityError(
        'Unauthorized to spawn agents',
        'UNAUTHORIZED',
        { userId: context.userId, operation: 'spawnAgent', agentType: profile.type }
      );
    }

    // Check command whitelist if enforced
    if (this.config.security?.enforceWhitelist) {
      const commandAllowed = await this.security.checkCommandAccess(
        'agent',
        ['spawn', profile.type],
        context
      );
      
      if (!commandAllowed) {
        throw new SecurityError(
          `Agent type '${profile.type}' not allowed`,
          'UNAUTHORIZED',
          { agentType: profile.type, reason: 'Not in whitelist' }
        );
      }
    }

    // Log agent spawn attempt
    await this.security.auditLog(
      AuditEventType.PROCESS_SPAWN,
      context,
      {
        action: 'spawn_agent',
        agentType: profile.type,
        agentId: profile.id,
        capabilities: profile.capabilities,
      }
    );

    try {
      // Perform actual agent spawn
      const agentId = await this.orchestrator.spawnAgent(profile);

      // Log successful spawn
      await this.security.auditLog(
        AuditEventType.PROCESS_SPAWN,
        context,
        {
          action: 'agent_spawned',
          agentId,
          agentType: profile.type,
          success: true,
        }
      );

      return agentId;
    } catch (error) {
      // Log failed spawn
      await this.security.auditLog(
        AuditEventType.PROCESS_SPAWN,
        context,
        {
          action: 'agent_spawn_failed',
          agentType: profile.type,
          error: error instanceof Error ? error.message : 'Unknown error',
          success: false,
        }
      );
      throw error;
    }
  }

  async terminateAgent(agentId: string): Promise<void> {
    const context = this.getContext();
    
    // Validate agent ID
    const validation = await this.security.validateInput('command', agentId);
    if (!validation.valid) {
      throw new SecurityError(
        `Invalid agent ID: ${validation.error}`,
        'INVALID_INPUT',
        { agentId }
      );
    }

    // Check authorization
    const authorized = await this.security.authorize(context, 'agents', 'terminate');
    if (!authorized) {
      throw new SecurityError(
        'Unauthorized to terminate agents',
        'UNAUTHORIZED',
        { userId: context.userId, operation: 'terminateAgent', agentId }
      );
    }

    // Log termination attempt
    await this.security.auditLog(
      AuditEventType.PROCESS_TERMINATE,
      context,
      {
        action: 'terminate_agent',
        agentId,
      }
    );

    try {
      await this.orchestrator.terminateAgent(agentId);

      // Log successful termination
      await this.security.auditLog(
        AuditEventType.PROCESS_TERMINATE,
        context,
        {
          action: 'agent_terminated',
          agentId,
          success: true,
        }
      );
    } catch (error) {
      // Log failed termination
      await this.security.auditLog(
        AuditEventType.PROCESS_TERMINATE,
        context,
        {
          action: 'agent_termination_failed',
          agentId,
          error: error instanceof Error ? error.message : 'Unknown error',
          success: false,
        }
      );
      throw error;
    }
  }

  async assignTask(task: Task): Promise<void> {
    const context = this.getContext();
    
    // Validate task data
    const validation = await this.security.validateInput('command', task.type);
    if (!validation.valid) {
      throw new SecurityError(
        `Invalid task type: ${validation.error}`,
        'INVALID_INPUT',
        { taskType: task.type }
      );
    }

    // Check authorization
    const authorized = await this.security.authorize(context, 'tasks', 'create');
    if (!authorized) {
      throw new SecurityError(
        'Unauthorized to assign tasks',
        'UNAUTHORIZED',
        { userId: context.userId, operation: 'assignTask', taskType: task.type }
      );
    }

    // Log task assignment
    await this.security.auditLog(
      AuditEventType.DATA_MODIFICATION,
      context,
      {
        action: 'assign_task',
        taskId: task.id,
        taskType: task.type,
        priority: task.priority,
      }
    );

    try {
      await this.orchestrator.assignTask(task);

      // Log successful assignment
      await this.security.auditLog(
        AuditEventType.DATA_MODIFICATION,
        context,
        {
          action: 'task_assigned',
          taskId: task.id,
          success: true,
        }
      );
    } catch (error) {
      // Log failed assignment
      await this.security.auditLog(
        AuditEventType.DATA_MODIFICATION,
        context,
        {
          action: 'task_assignment_failed',
          taskId: task.id,
          error: error instanceof Error ? error.message : 'Unknown error',
          success: false,
        }
      );
      throw error;
    }
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const context = this.getContext();
    
    // Check authorization
    const authorized = await this.security.authorize(context, 'system', 'health');
    if (!authorized) {
      throw new SecurityError(
        'Unauthorized to view health status',
        'UNAUTHORIZED',
        { userId: context.userId, operation: 'getHealthStatus' }
      );
    }

    // Log health check
    await this.security.auditLog(
      AuditEventType.DATA_ACCESS,
      context,
      {
        action: 'health_check',
        resource: 'system_health',
      }
    );

    return this.orchestrator.getHealthStatus();
  }

  async getMetrics(): Promise<OrchestratorMetrics> {
    const context = this.getContext();
    
    // Check authorization
    const authorized = await this.security.authorize(context, 'system', 'metrics');
    if (!authorized) {
      throw new SecurityError(
        'Unauthorized to view metrics',
        'UNAUTHORIZED',
        { userId: context.userId, operation: 'getMetrics' }
      );
    }

    // Log metrics access
    await this.security.auditLog(
      AuditEventType.DATA_ACCESS,
      context,
      {
        action: 'metrics_access',
        resource: 'system_metrics',
      }
    );

    return this.orchestrator.getMetrics();
  }

  async performMaintenance(): Promise<void> {
    const context = this.getContext();
    
    // Check authorization - maintenance requires admin permissions
    const authorized = await this.security.authorize(context, 'admin', 'maintenance');
    if (!authorized) {
      throw new SecurityError(
        'Unauthorized to perform maintenance',
        'UNAUTHORIZED',
        { userId: context.userId, operation: 'performMaintenance' }
      );
    }

    // Log maintenance operation
    await this.security.auditLog(
      AuditEventType.SYSTEM_ACCESS,
      context,
      {
        action: 'maintenance_start',
        timestamp: new Date(),
      }
    );

    try {
      await this.orchestrator.performMaintenance();

      // Log successful maintenance
      await this.security.auditLog(
        AuditEventType.SYSTEM_ACCESS,
        context,
        {
          action: 'maintenance_complete',
          success: true,
        }
      );
    } catch (error) {
      // Log failed maintenance
      await this.security.auditLog(
        AuditEventType.SYSTEM_ACCESS,
        context,
        {
          action: 'maintenance_failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          success: false,
        }
      );
      throw error;
    }
  }
}

/**
 * Factory function to create a secure orchestrator
 */
export function createSecureOrchestrator(
  orchestrator: IOrchestrator,
  logger: ILogger,
  config: SecureOrchestratorConfig,
): SecureOrchestrator {
  return new SecureOrchestrator(orchestrator, logger, config);
}