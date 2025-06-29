/**
 * Command whitelisting and authorization system
 */

import { ILogger } from '../core/logger.js';
import { IAuditLogger, AuditHelpers } from './audit-logger.js';

export interface CommandPolicy {
  command: string;
  description: string;
  allowedArgs?: string[];
  blockedArgs?: string[];
  requiresAuth?: boolean;
  minPermissionLevel?: string;
  maxExecutions?: number;
  rateLimit?: {
    window: number; // milliseconds
    maxRequests: number;
  };
}

export interface ICommandWhitelist {
  isAllowed(command: string, args: string[], userId?: string): Promise<boolean>;
  addPolicy(policy: CommandPolicy): void;
  removePolicy(command: string): void;
  getPolicies(): CommandPolicy[];
  checkRateLimit(command: string, userId: string): Promise<boolean>;
}

export class CommandWhitelist implements ICommandWhitelist {
  private policies = new Map<string, CommandPolicy>();
  private executionCounts = new Map<string, number>();
  private rateLimitWindows = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private config: {
      defaultPolicies?: CommandPolicy[];
      strictMode?: boolean;
      enableRateLimiting?: boolean;
    },
    private logger: ILogger,
    private auditLogger?: IAuditLogger,
  ) {
    // Initialize default policies
    this.initializeDefaultPolicies();
    
    // Add custom policies
    if (config.defaultPolicies) {
      config.defaultPolicies.forEach((policy) => this.addPolicy(policy));
    }
  }

  private initializeDefaultPolicies(): void {
    const defaults: CommandPolicy[] = [
      // System information commands
      {
        command: 'status',
        description: 'Get system status',
        requiresAuth: false,
      },
      {
        command: 'version',
        description: 'Get version information',
        requiresAuth: false,
      },
      {
        command: 'help',
        description: 'Get help information',
        requiresAuth: false,
      },

      // Agent management commands
      {
        command: 'agent',
        description: 'Agent management',
        allowedArgs: ['spawn', 'list', 'info', 'terminate'],
        requiresAuth: true,
        minPermissionLevel: 'agents.*',
        rateLimit: {
          window: 60000, // 1 minute
          maxRequests: 10,
        },
      },

      // Task management commands
      {
        command: 'task',
        description: 'Task management',
        allowedArgs: ['create', 'list', 'status', 'cancel'],
        requiresAuth: true,
        minPermissionLevel: 'tasks.*',
      },

      // Memory operations
      {
        command: 'memory',
        description: 'Memory operations',
        allowedArgs: ['store', 'get', 'list', 'delete', 'stats'],
        requiresAuth: true,
        minPermissionLevel: 'memory.*',
        rateLimit: {
          window: 60000, // 1 minute
          maxRequests: 100,
        },
      },

      // SPARC mode execution
      {
        command: 'sparc',
        description: 'SPARC development mode',
        requiresAuth: true,
        minPermissionLevel: 'sparc.execute',
        rateLimit: {
          window: 300000, // 5 minutes
          maxRequests: 5,
        },
      },

      // Swarm coordination
      {
        command: 'swarm',
        description: 'Swarm coordination',
        requiresAuth: true,
        minPermissionLevel: 'swarm.coordinate',
        maxExecutions: 3, // Limit concurrent swarms
        rateLimit: {
          window: 600000, // 10 minutes
          maxRequests: 2,
        },
      },

      // Configuration commands
      {
        command: 'config',
        description: 'Configuration management',
        allowedArgs: ['show', 'get', 'set', 'validate'],
        blockedArgs: ['reset', 'delete-all'],
        requiresAuth: true,
        minPermissionLevel: 'admin.config',
      },
    ];

    defaults.forEach((policy) => this.policies.set(policy.command, policy));
  }

  async isAllowed(command: string, args: string[], userId?: string): Promise<boolean> {
    try {
      // In strict mode, only whitelisted commands are allowed
      if (this.config.strictMode && !this.policies.has(command)) {
        this.logger.warn('Command not in whitelist (strict mode)', { command, userId });
        await this.logCommandAttempt(command, args, userId || 'anonymous', false, 'Not in whitelist');
        return false;
      }

      const policy = this.policies.get(command);
      if (!policy) {
        // If not in strict mode, allow unlisted commands
        return !this.config.strictMode;
      }

      // Check authentication requirement
      if (policy.requiresAuth && !userId) {
        await this.logCommandAttempt(command, args, 'anonymous', false, 'Authentication required');
        return false;
      }

      // Check allowed arguments
      if (policy.allowedArgs && args.length > 0) {
        const firstArg = args[0];
        if (!policy.allowedArgs.includes(firstArg)) {
          await this.logCommandAttempt(command, args, userId || 'anonymous', false, 'Invalid argument');
          return false;
        }
      }

      // Check blocked arguments
      if (policy.blockedArgs) {
        for (const arg of args) {
          if (policy.blockedArgs.includes(arg)) {
            await this.logCommandAttempt(command, args, userId || 'anonymous', false, 'Blocked argument');
            return false;
          }
        }
      }

      // Check execution limits
      if (policy.maxExecutions) {
        const count = this.executionCounts.get(command) || 0;
        if (count >= policy.maxExecutions) {
          await this.logCommandAttempt(command, args, userId || 'anonymous', false, 'Execution limit reached');
          return false;
        }
      }

      // Check rate limits
      if (policy.rateLimit && this.config.enableRateLimiting && userId) {
        const allowed = await this.checkRateLimit(command, userId);
        if (!allowed) {
          await this.logCommandAttempt(command, args, userId, false, 'Rate limit exceeded');
          return false;
        }
      }

      // Update execution count
      if (policy.maxExecutions) {
        this.executionCounts.set(command, (this.executionCounts.get(command) || 0) + 1);
      }

      // Log successful authorization
      await this.logCommandAttempt(command, args, userId || 'anonymous', true);

      return true;
    } catch (error) {
      this.logger.error('Error checking command authorization', error);
      return false;
    }
  }

  async checkRateLimit(command: string, userId: string): Promise<boolean> {
    const policy = this.policies.get(command);
    if (!policy?.rateLimit) {
      return true;
    }

    const key = `${command}:${userId}`;
    const now = Date.now();
    const window = this.rateLimitWindows.get(key);

    if (!window || now - window.windowStart > policy.rateLimit.window) {
      // New window
      this.rateLimitWindows.set(key, {
        count: 1,
        windowStart: now,
      });
      return true;
    }

    if (window.count >= policy.rateLimit.maxRequests) {
      return false;
    }

    window.count++;
    return true;
  }

  addPolicy(policy: CommandPolicy): void {
    this.policies.set(policy.command, policy);
    this.logger.info('Command policy added', {
      command: policy.command,
      description: policy.description,
    });
  }

  removePolicy(command: string): void {
    this.policies.delete(command);
    this.executionCounts.delete(command);
    this.logger.info('Command policy removed', { command });
  }

  getPolicies(): CommandPolicy[] {
    return Array.from(this.policies.values());
  }

  private async logCommandAttempt(
    command: string,
    args: string[],
    userId: string,
    allowed: boolean,
    reason?: string,
  ): Promise<void> {
    if (this.auditLogger) {
      await AuditHelpers.logCommandExecution(
        this.auditLogger,
        userId,
        command,
        args,
        allowed,
        reason,
      );
    }
  }
}

/**
 * Factory function for creating command whitelist
 */
export function createCommandWhitelist(
  config: {
    defaultPolicies?: CommandPolicy[];
    strictMode?: boolean;
    enableRateLimiting?: boolean;
  },
  logger: ILogger,
  auditLogger?: IAuditLogger,
): ICommandWhitelist {
  return new CommandWhitelist(config, logger, auditLogger);
}

/**
 * Pre-defined command categories for easy policy creation
 */
export const CommandCategories = {
  SYSTEM: ['status', 'version', 'help', 'monitor'],
  AGENT: ['agent', 'spawn'],
  TASK: ['task', 'workflow'],
  MEMORY: ['memory'],
  DEVELOPMENT: ['sparc', 'swarm', 'mcp'],
  ADMIN: ['config', 'security', 'audit'],
  CLOUD: ['deploy', 'cloud', 'project'],
} as const;

/**
 * Helper to create policies for entire categories
 */
export function createCategoryPolicies(
  category: keyof typeof CommandCategories,
  options: {
    requiresAuth?: boolean;
    minPermissionLevel?: string;
    rateLimit?: { window: number; maxRequests: number };
  },
): CommandPolicy[] {
  return CommandCategories[category].map((command) => ({
    command,
    description: `${category} command: ${command}`,
    ...options,
  }));
}