import { spawn } from 'child_process';
import { Logger } from '../../core/logger.js';
import type {
  PreTaskOptions,
  PostTaskOptions,
  PreEditOptions,
  PostEditOptions,
  PreCommandOptions,
  PostCommandOptions,
  SessionStartOptions,
  SessionEndOptions,
  SessionRestoreOptions,
  PreSearchOptions,
  NotificationOptions,
  HookCommandOptions,
  PerformanceOptions,
  MemorySyncOptions,
  TelemetryOptions,
} from './hook-types.js';

const logger = new Logger(
  {
    level: 'info',
    format: 'text',
    destination: 'console',
  },
  { prefix: 'Hook' },
);

// Helper function to build command arguments
function buildArgs(hookType: string, options: Record<string, any>): string[] {
  const args = [hookType];

  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      const flagName = key.replace(/([A-Z])/g, '-$1').toLowerCase();

      if (typeof value === 'boolean') {
        if (value) {
          args.push(`--${flagName}`);
        } else {
          args.push(`--no-${flagName}`);
        }
      } else {
        args.push(`--${flagName}`, String(value));
      }
    }
  });

  return args;
}

// Hook subcommand handlers
const hookHandlers: Record<string, (args: string[]) => Promise<void>> = {
  'pre-task': async (args: string[]) => {
    const options = parseArgs<PreTaskOptions>(args);
    await executeHook('pre-task', options);
  },

  'post-task': async (args: string[]) => {
    const options = parseArgs<PostTaskOptions>(args);
    if (!options.taskId) {
      throw new Error('--task-id is required for post-task hook');
    }
    await executeHook('post-task', options);
  },

  'pre-edit': async (args: string[]) => {
    const options = parseArgs<PreEditOptions>(args);
    if (!options.file) {
      throw new Error('--file is required for pre-edit hook');
    }
    await executeHook('pre-edit', options);
  },

  'post-edit': async (args: string[]) => {
    const options = parseArgs<PostEditOptions>(args);
    if (!options.file) {
      throw new Error('--file is required for post-edit hook');
    }
    await executeHook('post-edit', options);
  },

  'pre-command': async (args: string[]) => {
    const options = parseArgs<PreCommandOptions>(args);
    if (!options.command) {
      throw new Error('--command is required for pre-command hook');
    }
    await executeHook('pre-command', options);
  },

  'post-command': async (args: string[]) => {
    const options = parseArgs<PostCommandOptions>(args);
    if (!options.command) {
      throw new Error('--command is required for post-command hook');
    }
    await executeHook('post-command', options);
  },

  'session-start': async (args: string[]) => {
    const options = parseArgs<SessionStartOptions>(args);
    await executeHook('session-start', options);
  },

  'session-end': async (args: string[]) => {
    const options = parseArgs<SessionEndOptions>(args);
    await executeHook('session-end', options);
  },

  'session-restore': async (args: string[]) => {
    const options = parseArgs<SessionRestoreOptions>(args);
    if (!options.sessionId) {
      throw new Error('--session-id is required for session-restore hook');
    }
    await executeHook('session-restore', options);
  },

  'pre-search': async (args: string[]) => {
    const options = parseArgs<PreSearchOptions>(args);
    if (!options.query) {
      throw new Error('--query is required for pre-search hook');
    }
    await executeHook('pre-search', options);
  },

  notification: async (args: string[]) => {
    const options = parseArgs<NotificationOptions>(args);
    if (!options.message) {
      throw new Error('--message is required for notification hook');
    }
    await executeHook('notification', options);
  },

  performance: async (args: string[]) => {
    const options = parseArgs<PerformanceOptions>(args);
    await executeHook('performance', options);
  },

  'memory-sync': async (args: string[]) => {
    const options = parseArgs<MemorySyncOptions>(args);
    await executeHook('memory-sync', options);
  },

  telemetry: async (args: string[]) => {
    const options = parseArgs<TelemetryOptions>(args);
    if (!options.event) {
      throw new Error('--event is required for telemetry hook');
    }
    await executeHook('telemetry', options);
  },
};

// Parse command line arguments
function parseArgs<T extends Record<string, any>>(args: string[]): T {
  const options: Record<string, any> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const nextArg = args[i + 1];

      if (!nextArg || nextArg.startsWith('--')) {
        // Boolean flag
        options[key] = !arg.startsWith('--no-');
      } else {
        // Value flag
        options[key] = nextArg;
        i++; // Skip next arg
      }
    }
  }

  return options as T;
}

// Execute hook with ruv-swarm
async function executeHook(hookType: string, options: Record<string, any>): Promise<void> {
  const args = buildArgs(hookType, options);

  logger.debug(`Executing hook: ruv-swarm hook ${args.join(' ')}`);

  const child = spawn('npx', ['ruv-swarm', 'hook', ...args], {
    stdio: 'inherit',
    shell: true,
  });

  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Hook ${hookType} failed with exit code ${code}`));
      }
    });

    child.on('error', (error) => {
      logger.error(`Failed to execute hook ${hookType}:`, error);
      reject(error);
    });
  });
}

// Main hook command handler
export const hookCommand = {
  name: 'hook',
  description: 'Execute ruv-swarm hooks for agent coordination',
  action: async ({ args }: HookCommandOptions): Promise<void> => {
    try {
      if (args.length === 0) {
        showHookHelp();
        return;
      }

      const subcommand = args[0];
      const handler = hookHandlers[subcommand];

      if (!handler) {
        logger.error(`Unknown hook subcommand: ${subcommand}`);
        showHookHelp();
        throw new Error(`Unknown hook subcommand: ${subcommand}`);
      }

      await handler(args.slice(1));
    } catch (error) {
      logger.error('Hook command error:', error);
      throw error;
    }
  },
};

// Show help for hook commands
function showHookHelp(): void {
  console.log(`
Claude Flow Hook Commands
========================

Available hooks:

  pre-task      - Run before starting a task
    --description <desc>      Task description
    --auto-spawn-agents       Auto-spawn agents (default: true)
    --complexity <level>      Task complexity: low|medium|high
    --estimated-minutes <n>   Estimated duration
    --requires-research       Task requires research
    --requires-testing        Task requires testing

  post-task     - Run after completing a task
    --task-id <id>           Task ID (required)
    --analyze-performance    Analyze performance metrics
    --generate-report        Generate completion report

  pre-edit      - Run before editing a file
    --file <path>            File path (required)
    --operation <op>         Operation type: read|write|edit|delete
    --validate               Validate file before edit

  post-edit     - Run after editing a file
    --file <path>            File path (required)
    --memory-key <key>       Store in memory with key
    --format                 Auto-format code
    --analyze                Analyze changes

  pre-command   - Run before executing a command
    --command <cmd>          Command to execute (required)
    --validate               Validate command safety
    --sandbox                Run in sandbox mode

  post-command  - Run after executing a command
    --command <cmd>          Command executed (required)
    --exit-code <code>       Command exit code
    --duration <ms>          Execution duration

  session-start - Run at session start
    --session-id <id>        Session identifier
    --load-previous          Load previous session data
    --auto-restore           Auto-restore context

  session-end   - Run at session end
    --session-id <id>        Session identifier
    --export-metrics         Export performance metrics
    --generate-summary       Generate session summary
    --save-to <path>         Save session data to path

  session-restore - Restore a previous session
    --session-id <id>        Session ID to restore (required)
    --load-memory            Load memory state
    --load-agents            Load agent configuration
    --load-tasks             Load task list

  pre-search    - Run before searching
    --query <text>           Search query (required)
    --cache-results          Cache search results
    --max-results <n>        Maximum results to return

  notification  - Send a notification
    --message <text>         Notification message (required)
    --level <level>          Message level: info|warning|error
    --telemetry              Include in telemetry
    --persist                Persist notification

  performance   - Track performance metrics
    --operation <name>       Operation name
    --duration <ms>          Operation duration
    --metrics <json>         Performance metrics as JSON

  memory-sync   - Synchronize memory state
    --namespace <name>       Memory namespace
    --direction <dir>        Sync direction: push|pull|sync
    --target <location>      Target location for sync

  telemetry     - Send telemetry data
    --event <name>           Event name (required)
    --data <json>            Event data as JSON
    --tags <list>            Comma-separated tags

Common options:
  --verbose                  Show detailed output
  --metadata <json>          Additional metadata as JSON

Examples:
  claude hook pre-task --description "Build REST API" --complexity high
  claude hook post-edit --file src/index.js --memory-key "api/implementation"
  claude hook session-end --export-metrics --generate-summary
  claude hook performance --operation "api-build" --duration 1234
  claude hook memory-sync --namespace "project" --direction push
  claude hook telemetry --event "task-completed" --data '{"taskId":"123"}'
`);
}

// Export hook subcommands for better CLI integration
export const hookSubcommands = [
  'pre-task',
  'post-task',
  'pre-edit',
  'post-edit',
  'pre-command',
  'post-command',
  'session-start',
  'session-end',
  'session-restore',
  'pre-search',
  'notification',
  'performance',
  'memory-sync',
  'telemetry',
];
