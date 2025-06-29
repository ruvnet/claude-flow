/**
 * Example integration of security controls into Claude-Flow
 */

import { Command } from '@cliffy/command';
import { logger } from '../core/logger';
import { Config } from '../utils/types.js';
import { Orchestrator } from '../core/orchestrator.js';
import { createSecureOrchestrator } from '../core/secure-orchestrator.js';
import { addSecurityMiddleware, createAuthCommand } from '../cli/secure-cli.js';
import { createEventBus } from '../core/event-bus.js';
import { createTerminalManager } from '../terminal/manager.js';
import { createMemoryManager } from '../memory/manager.js';
import { createCoordinationManager } from '../coordination/manager.js';
import { createMCPServer } from '../mcp/server.js';

/**
 * Example: Creating a secure orchestrator
 */
export async function createSecureOrchestratorExample() {
  const logger = createLogger({ level: 'info' });
  const config: Config = {
    orchestrator: {
      maxConcurrentAgents: 5,
      taskQueueSize: 100,
      dataDir: './data',
      enablePersistence: true,
    },
    security: {
      enabled: true,
      requireAuth: true,
      enforceWhitelist: true,
      auditAll: true,
    },
  };

  // Create dependencies
  const eventBus = createEventBus(logger);
  const terminalManager = createTerminalManager(config, logger);
  const memoryManager = createMemoryManager(config, logger);
  const coordinationManager = createCoordinationManager(eventBus, logger);
  const mcpServer = createMCPServer(config, logger);

  // Create base orchestrator
  const baseOrchestrator = new Orchestrator(
    config,
    terminalManager,
    memoryManager,
    coordinationManager,
    mcpServer,
    eventBus,
    logger,
  );

  // Wrap with security
  const secureOrchestrator = createSecureOrchestrator(
    baseOrchestrator,
    logger,
    config,
  );

  // Example: Authenticate and use orchestrator
  const authResult = await secureOrchestrator.authenticate({
    token: 'your-auth-token-here',
  });

  if (authResult.success && authResult.context) {
    secureOrchestrator.setSecurityContext(authResult.context);

    // Now all operations will be secured
    await secureOrchestrator.initialize();
    
    // Spawn an agent (will check permissions and log)
    const agentId = await secureOrchestrator.spawnAgent({
      id: 'agent-1',
      type: 'researcher',
      capabilities: ['search', 'analyze'],
      config: {},
    });

    logger.info('Agent spawned securely', { agentId });
  }
}

/**
 * Example: Creating a secure CLI application
 */
export function createSecureCLIExample() {
  const logger = createLogger({ level: 'info' });
  const config: Config = {
    orchestrator: {
      maxConcurrentAgents: 5,
      taskQueueSize: 100,
    },
  };

  // Create base CLI app
  const app = new Command()
    .name('claude-flow')
    .version('1.0.0')
    .description('Claude-Flow CLI');

  // Add commands
  app
    .command('status', 'Get system status')
    .action(() => {
      console.log('System status: OK');
    });

  app
    .command('agent')
    .description('Agent management')
    .command('spawn <type:string>', 'Spawn a new agent')
    .action((type: string) => {
      console.log(`Spawning ${type} agent...`);
    });

  app
    .command('task')
    .description('Task management')
    .command('create <type:string>', 'Create a new task')
    .option('-p, --priority <priority:string>', 'Task priority')
    .action((type: string, options: any) => {
      console.log(`Creating ${type} task with priority ${options.priority || 'normal'}`);
    });

  // Add security middleware
  const secureCLI = addSecurityMiddleware(app, logger, config, {
    requireAuth: true,
    sessionTimeout: 3600000, // 1 hour
  });

  // Add auth command
  app.command('auth', createAuthCommand(secureCLI));

  return app;
}

/**
 * Example: Using security components directly
 */
export async function directSecurityExample() {
  const logger = createLogger({ level: 'info' });
  
  // Import security components
  const {
    createSecurityMiddleware,
    DefaultSecurityConfig,
    createAuditLogger,
    createInputValidator,
    createCommandWhitelist,
    AuditEventType,
    AuditHelpers,
  } = await import('./index.js');

  // Create security middleware
  const security = createSecurityMiddleware(DefaultSecurityConfig, logger);

  // Example 1: Authentication
  const authResult = await security.authenticate({
    username: 'admin',
    password: 'secure-password',
  });

  if (authResult.success && authResult.context) {
    logger.info('Authenticated', { userId: authResult.context.userId });

    // Example 2: Authorization check
    const canSpawnAgents = await security.authorize(
      authResult.context,
      'agents',
      'spawn',
    );
    logger.info('Can spawn agents?', { allowed: canSpawnAgents });

    // Example 3: Input validation
    const commandValidation = await security.validateInput(
      'command',
      'agent spawn researcher',
    );
    logger.info('Command valid?', { valid: commandValidation.valid });

    // Example 4: Command access check
    const commandAllowed = await security.checkCommandAccess(
      'agent',
      ['spawn', 'researcher'],
      authResult.context,
    );
    logger.info('Command allowed?', { allowed: commandAllowed });

    // Example 5: Audit logging
    await security.auditLog(
      AuditEventType.PROCESS_SPAWN,
      authResult.context,
      {
        action: 'spawn_agent',
        agentType: 'researcher',
        success: true,
      },
    );
  }

  // Example 6: Direct component usage
  const auditLogger = createAuditLogger(
    {
      logDir: './logs/audit',
      rotationInterval: 86400000,
      retentionDays: 90,
    },
    logger,
  );

  const inputValidator = createInputValidator(
    {
      enableStrictMode: true,
      blockedCommands: ['rm', 'del'],
      blockedPaths: ['/etc/*', '*.key'],
    },
    logger,
  );

  const commandWhitelist = createCommandWhitelist(
    {
      strictMode: true,
      enableRateLimiting: true,
    },
    logger,
    auditLogger,
  );

  // Use components
  const pathValidation = inputValidator.validatePath('/home/user/file.txt');
  logger.info('Path valid?', { valid: pathValidation.valid });

  const isCommandAllowed = await commandWhitelist.isAllowed(
    'status',
    [],
    'user123',
  );
  logger.info('Status command allowed?', { allowed: isCommandAllowed });
}

/**
 * Example: Integrating security into existing code
 */
export function integrationPatterns() {
  // Pattern 1: Wrap existing functions with security checks
  async function secureFunction<T>(
    fn: () => Promise<T>,
    security: any,
    context: any,
    resource: string,
    action: string,
  ): Promise<T> {
    // Check authorization
    const authorized = await security.authorize(context, resource, action);
    if (!authorized) {
      throw new Error(`Unauthorized: ${resource}.${action}`);
    }

    // Log access
    await security.auditLog('DATA_ACCESS', context, {
      resource,
      action,
      timestamp: new Date(),
    });

    // Execute function
    try {
      const result = await fn();
      
      // Log success
      await security.auditLog('DATA_ACCESS', context, {
        resource,
        action,
        success: true,
      });

      return result;
    } catch (error) {
      // Log failure
      await security.auditLog('DATA_ACCESS', context, {
        resource,
        action,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Pattern 2: Security middleware for HTTP endpoints
  function securityMiddleware(security: any) {
    return async (req: any, res: any, next: any) => {
      try {
        // Extract token from header
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        // Authenticate
        const authResult = await security.authenticate({ token });
        if (!authResult.success || !authResult.context) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        // Attach context to request
        req.securityContext = authResult.context;

        // Log request
        await security.auditLog('SYSTEM_ACCESS', authResult.context, {
          method: req.method,
          path: req.path,
          ip: req.ip,
        });

        next();
      } catch (error) {
        res.status(500).json({ error: 'Security error' });
      }
    };
  }

  // Pattern 3: Secure command execution
  async function executeSecureCommand(
    command: string,
    args: string[],
    security: any,
    context: any,
  ): Promise<any> {
    // Validate inputs
    const commandValidation = await security.validateInput('command', command);
    if (!commandValidation.valid) {
      throw new Error(`Invalid command: ${commandValidation.error}`);
    }

    const argsValidation = await security.validateInput('args', args);
    if (!argsValidation.valid) {
      throw new Error(`Invalid arguments: ${argsValidation.error}`);
    }

    // Check command access
    const allowed = await security.checkCommandAccess(
      commandValidation.sanitized,
      argsValidation.sanitized,
      context,
    );

    if (!allowed) {
      throw new Error(`Command not allowed: ${command}`);
    }

    // Execute command (example)
    console.log(`Executing: ${command} ${args.join(' ')}`);
    
    return { success: true };
  }
}

// Export example runners
export const SecurityExamples = {
  runOrchestratorExample: createSecureOrchestratorExample,
  createCLI: createSecureCLIExample,
  runDirectExample: directSecurityExample,
  patterns: integrationPatterns,
};