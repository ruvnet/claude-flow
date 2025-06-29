/**
 * Secure CLI integration with authentication and authorization
 */

import { Command } from '@cliffy/command';
import { ILogger } from '../core/logger.js';
import {
  ISecurityMiddleware,
  SecurityContext,
  createSecurityMiddleware,
  DefaultSecurityConfig,
  SecurityError,
  AuditEventType,
} from '../security/index.js';
import { Config } from '../utils/types.js';

export interface SecureCLIOptions {
  requireAuth?: boolean;
  sessionTimeout?: number;
  tokenFile?: string;
}

export class SecureCLI {
  private security: ISecurityMiddleware;
  private context?: SecurityContext;
  private sessionStartTime?: Date;

  constructor(
    private logger: ILogger,
    private config: Config,
    private options: SecureCLIOptions = {},
  ) {
    // Initialize security middleware
    const securityConfig = {
      ...DefaultSecurityConfig,
      authentication: {
        ...DefaultSecurityConfig.authentication,
        enabled: options.requireAuth ?? true,
        sessionTimeout: options.sessionTimeout ?? 3600000, // 1 hour
      },
    };

    this.security = createSecurityMiddleware(securityConfig, logger);
  }

  /**
   * Wrap a command with security checks
   */
  secureCommand(command: Command): Command {
    const originalAction = command.action;

    command.action(async function(this: Command, ...args: any[]): Promise<void> {
      const secureCLI = (this as any).secureCLI as SecureCLI;
      
      try {
        // Check if authentication is required
        if (secureCLI.options.requireAuth) {
          await secureCLI.ensureAuthenticated();
        }

        // Get command name and arguments
        const commandName = (this as any).getName ? (this as any).getName() : (this as any)._name || 'unknown';
        const commandArgs = args.map(arg => String(arg));

        // Validate command and arguments
        const validation = await secureCLI.security.validateInput('command', commandName);
        if (!validation.valid) {
          throw new SecurityError(
            `Invalid command: ${validation.error}`,
            'INVALID_INPUT',
            { command: commandName }
          );
        }

        // Check command access
        const context = secureCLI.context || { userId: 'anonymous' };
        const allowed = await secureCLI.security.checkCommandAccess(
          commandName,
          commandArgs,
          context
        );

        if (!allowed) {
          throw new SecurityError(
            `Access denied for command: ${commandName}`,
            'UNAUTHORIZED',
            { command: commandName, args: commandArgs }
          );
        }

        // Log command execution
        await secureCLI.security.auditLog(
          AuditEventType.COMMAND_EXECUTION,
          context,
          {
            action: 'execute_command',
            command: commandName,
            args: commandArgs,
            timestamp: new Date(),
          }
        );

        // Execute original action
        if (originalAction) {
          await (originalAction as any).apply(this, args);
        }
      } catch (error) {
        // Log command failure
        await secureCLI.security.auditLog(
          AuditEventType.COMMAND_EXECUTION,
          secureCLI.context || { userId: 'anonymous' },
          {
            action: 'command_failed',
            command: (this as any).getName ? (this as any).getName() : (this as any)._name || 'unknown',
            error: error instanceof Error ? error.message : 'Unknown error',
            success: false,
          }
        );

        if (error instanceof SecurityError) {
          secureCLI.logger.error(`Security error: ${error.message}`, error.details);
          throw new Error(`Security error: ${error.message}`);
        }
        throw error;
      }
    });

    // Store reference to this SecureCLI instance
    (command as any).secureCLI = this;

    // Recursively secure subcommands
    const subCommands = (command as any).commands;
    if (subCommands) {
      for (const subCommand of subCommands.values()) {
        this.secureCommand(subCommand);
      }
    }

    return command;
  }

  /**
   * Ensure user is authenticated
   */
  private async ensureAuthenticated(): Promise<void> {
    // Check if session is still valid
    if (this.context && this.sessionStartTime) {
      const sessionAge = Date.now() - this.sessionStartTime.getTime();
      if (sessionAge > (this.options.sessionTimeout || 3600000)) {
        this.logger.info('Session expired, re-authentication required');
        this.context = undefined;
        this.sessionStartTime = undefined;
      }
    }

    if (!this.context) {
      // Try to load token from file if specified
      if (this.options.tokenFile) {
        try {
          const { readFile } = await import('fs/promises');
          const token = await readFile(this.options.tokenFile, 'utf-8');
          const result = await this.security.authenticate({ token: token.trim() });
          
          if (result.success && result.context) {
            this.context = result.context;
            this.sessionStartTime = new Date();
            this.logger.info('Authenticated from token file', {
              userId: result.context.userId,
            });
            return;
          }
        } catch (error) {
          this.logger.debug('Failed to load token from file', error);
        }
      }

      // Interactive authentication
      const result = await this.interactiveAuth();
      if (!result.success || !result.context) {
        throw new SecurityError(
          'Authentication failed',
          'AUTH_FAILED',
          { reason: result.error }
        );
      }

      this.context = result.context;
      this.sessionStartTime = new Date();
    }
  }

  /**
   * Interactive authentication prompt
   */
  private async interactiveAuth(): Promise<{ success: boolean; context?: SecurityContext; error?: string }> {
    const { prompt, Select, Input } = await import('../utils/cliffy-compat/prompt.js');

    console.log('\n🔐 Authentication required\n');

    const authMethod = await Select.prompt({
      message: 'Select authentication method:',
      options: [
        { name: 'Token', value: 'token' },
        { name: 'Username/Password', value: 'basic' },
      ],
    });

    if (authMethod === 'token') {
      const token = await Input.prompt({
        message: 'Enter authentication token:',
      });

      return this.security.authenticate({ token });
    } else {
      const username = await Input.prompt({
        message: 'Username:',
      });

      const password = await Input.prompt({
        message: 'Password:',
      });

      return this.security.authenticate({ username, password });
    }
  }

  /**
   * Create a secure CLI application
   */
  static createApp(
    logger: ILogger,
    config: Config,
    options: SecureCLIOptions = {},
  ): { app: Command; secureCLI: SecureCLI } {
    const secureCLI = new SecureCLI(logger, config, options);
    
    const app = new Command()
      .name('claude-flow-secure')
      .version('1.0.0')
      .description('Secure Claude-Flow CLI with authentication and authorization');

    // Add global authentication options
    app
      .option('--token <token:string>', 'Authentication token')
      .option('--token-file <file:string>', 'File containing authentication token')
      .option('--no-auth', 'Disable authentication (if allowed by config)');

    // Handle global options
    // TODO: Fix globalAction - not available in current Cliffy version
    // app.globalAction(async (options: any) => {
    //   if (options.token) {
    //     const result = await secureCLI.security.authenticate({ token: options.token });
    //     if (result.success && result.context) {
    //       secureCLI.context = result.context;
    //       secureCLI.sessionStartTime = new Date();
    //     }
    //   } else if (options.tokenFile) {
    //     secureCLI.options.tokenFile = options.tokenFile;
    //   } else if (options.noAuth && !secureCLI.options.requireAuth) {
    //     secureCLI.context = { userId: 'anonymous' };
    //   }
    // });

    return { app, secureCLI };
  }

  /**
   * Get current security context
   */
  getContext(): SecurityContext | undefined {
    return this.context;
  }

  /**
   * Set security context (for programmatic use)
   */
  setContext(context: SecurityContext): void {
    this.context = context;
    this.sessionStartTime = new Date();
  }
}

/**
 * Middleware to add security to existing CLI commands
 */
export function addSecurityMiddleware(
  app: Command,
  logger: ILogger,
  config: Config,
  options: SecureCLIOptions = {},
): SecureCLI {
  const secureCLI = new SecureCLI(logger, config, options);
  
  // Recursively secure all commands
  secureCLI.secureCommand(app);
  
  return secureCLI;
}

/**
 * Helper to create auth command for CLI
 */
export function createAuthCommand(secureCLI: SecureCLI): Command {
  return new Command()
    .name('auth')
    .description('Authenticate with Claude-Flow')
    .option('-t, --token <token:string>', 'Use authentication token')
    .option('-f, --token-file <file:string>', 'Read token from file')
    .option('--generate-token', 'Generate a new authentication token')
    .action(async (options) => {
      if (options.generateToken) {
        // This would typically integrate with your auth system
        console.log('Token generation not implemented in this example');
        return;
      }

      let result;
      if (options.token) {
        result = await (secureCLI as any).security.authenticate({ token: options.token });
      } else if (options.tokenFile) {
        const { readFile } = await import('fs/promises');
        const token = await readFile(options.tokenFile, 'utf-8');
        result = await (secureCLI as any).security.authenticate({ token: token.trim() });
      } else {
        result = await (secureCLI as any).interactiveAuth();
      }

      if (result.success && result.context) {
        secureCLI.setContext(result.context);
        console.log(`✅ Authenticated as: ${result.context.userId}`);
        console.log(`📋 Permissions: ${result.context.permissions?.join(', ') || 'none'}`);
      } else {
        console.error(`❌ Authentication failed: ${result.error}`);
        process.exit(1);
      }
    });
}