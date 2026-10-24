/**
 * Settings.json Generator
 * Creates .claude/settings.json with V3-optimized hook configurations
 */

import type { InitOptions, HooksConfig } from './types.js';

/**
 * Generate the complete settings.json content
 */
export function generateSettings(options: InitOptions): object {
  const settings: Record<string, unknown> = {};

  // Add hooks if enabled
  if (options.components.settings) {
    settings.hooks = generateHooksConfig(options.hooks);
  }

  // Add statusLine configuration if enabled
  if (options.statusline.enabled) {
    settings.statusLine = generateStatusLineConfig(options);
  }

  // Add permissions
  settings.permissions = {
    // Auto-allow claude-flow MCP tools
    // Note: Use ":*" for prefix matching (not just "*")
    allow: [
      'Bash(npx claude-flow:*)',
      'Bash(npx @claude-flow/cli:*)',
      'mcp__claude-flow__:*',
    ],
    // Auto-deny dangerous operations
    deny: [],
  };

  // Note: Claude Code expects 'model' to be a string, not an object
  // Model preferences are stored in claudeFlow settings instead
  // settings.model = 'claude-sonnet-4-20250514'; // Uncomment if you want to set a default model

  // Add V3-specific settings
  settings.claudeFlow = {
    version: '3.0.0',
    enabled: true,
    modelPreferences: {
      default: 'claude-opus-4-5-20251101',
      routing: 'claude-3-5-haiku-20241022',
    },
    swarm: {
      topology: options.runtime.topology,
      maxAgents: options.runtime.maxAgents,
    },
    memory: {
      backend: options.runtime.memoryBackend,
      enableHNSW: options.runtime.enableHNSW,
    },
    neural: {
      enabled: options.runtime.enableNeural,
    },
    daemon: {
      autoStart: true,
      workers: [
        'map',           // Codebase mapping
        'audit',         // Security auditing (critical priority)
        'optimize',      // Performance optimization (high priority)
        'consolidate',   // Memory consolidation
        'testgaps',      // Test coverage gaps
        'ultralearn',    // Deep knowledge acquisition
        'deepdive',      // Deep code analysis
        'document',      // Auto-documentation for ADRs
        'refactor',      // Refactoring suggestions (DDD alignment)
        'benchmark',     // Performance benchmarking
      ],
      schedules: {
        audit: { interval: '1h', priority: 'critical' },
        optimize: { interval: '30m', priority: 'high' },
        consolidate: { interval: '2h', priority: 'low' },
        document: { interval: '1h', priority: 'normal', triggers: ['adr-update', 'api-change'] },
        deepdive: { interval: '4h', priority: 'normal', triggers: ['complex-change'] },
        ultralearn: { interval: '1h', priority: 'normal' },
      },
    },
    learning: {
      enabled: true,
      autoTrain: true,
      patterns: ['coordination', 'optimization', 'prediction'],
      retention: {
        shortTerm: '24h',
        longTerm: '30d',
      },
    },
    adr: {
      autoGenerate: true,
      directory: '/docs/adr',
      template: 'madr',
    },
    ddd: {
      trackDomains: true,
      validateBoundedContexts: true,
      directory: '/docs/ddd',
    },
    security: {
      autoScan: true,
      scanOnEdit: true,
      cveCheck: true,
      threatModel: true,
    },
  };

  return settings;
}

/**
 * Generate statusLine configuration for Claude Code
 * This configures the Claude Code status bar to show V3 metrics
 */
function generateStatusLineConfig(options: InitOptions): object {
  const config = options.statusline;

  // Build the command that generates the statusline
  // Uses npx @claude-flow/cli@latest (or @alpha) to run the hooks statusline command
  // Falls back to local helper script or simple "V3" if CLI not available
  // Default: full multi-line statusline with progress bars, metrics, and architecture status
  const statuslineCommand = 'npx @claude-flow/cli@latest hooks statusline 2>/dev/null || node .claude/helpers/statusline.cjs 2>/dev/null || echo "▊ Claude Flow V3"';

  return {
    // Type must be "command" for Claude Code validation
    type: 'command',
    // Command to execute for statusline content
    command: statuslineCommand,
    // Refresh interval in milliseconds (5 seconds default)
    refreshMs: config.refreshInterval,
    // Enable the statusline
    enabled: config.enabled,
  };
}

/**
 * Generate hooks configuration
 */
function generateHooksConfig(config: HooksConfig): object {
  const hooks: Record<string, unknown[]> = {};

  // PreToolUse hooks - cross-platform via npx with defensive guards
  if (config.preToolUse) {
    hooks.PreToolUse = [
      // File edit hooks with intelligence routing
      {
        matcher: '^(Write|Edit|MultiEdit)$',
        hooks: [
          {
            type: 'command',
            command: '[ -n "$TOOL_INPUT_file_path" ] && npx @claude-flow/cli@latest hooks pre-edit --file "$TOOL_INPUT_file_path" 2>/dev/null || true',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
      // Bash command hooks with safety validation
      {
        matcher: '^Bash$',
        hooks: [
          {
            type: 'command',
            command: '[ -n "$TOOL_INPUT_command" ] && npx @claude-flow/cli@latest hooks pre-command --command "$TOOL_INPUT_command" 2>/dev/null || true',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
      // Task/Agent hooks - require task-id for tracking
      {
        matcher: '^Task$',
        hooks: [
          {
            type: 'command',
            command: '[ -n "$TOOL_INPUT_prompt" ] && npx @claude-flow/cli@latest hooks pre-task --task-id "task-$(date +%s)" --description "$TOOL_INPUT_prompt" 2>/dev/null || true',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // PostToolUse hooks - cross-platform via npx with defensive guards
  if (config.postToolUse) {
    hooks.PostToolUse = [
      // File edit hooks with neural pattern training
      {
        matcher: '^(Write|Edit|MultiEdit)$',
        hooks: [
          {
            type: 'command',
            command: '[ -n "$TOOL_INPUT_file_path" ] && npx @claude-flow/cli@latest hooks post-edit --file "$TOOL_INPUT_file_path" --success "${TOOL_SUCCESS:-true}" 2>/dev/null || true',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
      // Bash command hooks with metrics tracking
      {
        matcher: '^Bash$',
        hooks: [
          {
            type: 'command',
            command: '[ -n "$TOOL_INPUT_command" ] && npx @claude-flow/cli@latest hooks post-command --command "$TOOL_INPUT_command" --success "${TOOL_SUCCESS:-true}" 2>/dev/null || true',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
      // Task completion hooks - use task-id
      {
        matcher: '^Task$',
        hooks: [
          {
            type: 'command',
            command: '[ -n "$TOOL_RESULT_agent_id" ] && npx @claude-flow/cli@latest hooks post-task --task-id "$TOOL_RESULT_agent_id" --success "${TOOL_SUCCESS:-true}" 2>/dev/null || true',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // UserPromptSubmit for intelligent routing
  if (config.userPromptSubmit) {
    hooks.UserPromptSubmit = [
      {
        hooks: [
          {
            type: 'command',
            command: '[ -n "$PROMPT" ] && npx @claude-flow/cli@latest hooks route --task "$PROMPT" || true',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // SessionStart for context loading and daemon auto-start
  if (config.sessionStart) {
    hooks.SessionStart = [
      {
        hooks: [
          {
            type: 'command',
            command: 'npx @claude-flow/cli@latest daemon start --quiet 2>/dev/null || true',
            timeout: 5000,
            continueOnError: true,
          },
          {
            type: 'command',
            command: '[ -n "$SESSION_ID" ] && npx @claude-flow/cli@latest hooks session-restore --session-id "$SESSION_ID" 2>/dev/null || true',
            timeout: 10000,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // Stop hooks for task evaluation - always return ok by default
  // The hook outputs JSON that Claude Code validates
  if (config.stop) {
    hooks.Stop = [
      {
        hooks: [
          {
            type: 'command',
            command: 'echo \'{"ok": true}\'',
            timeout: 1000,
          },
        ],
      },
    ];
  }

  // Notification hooks - store notifications in memory for swarm awareness
  if (config.notification) {
    hooks.Notification = [
      {
        hooks: [
          {
            type: 'command',
            command: '[ -n "$NOTIFICATION_MESSAGE" ] && npx @claude-flow/cli@latest memory store --namespace notifications --key "notify-$(date +%s)" --value "$NOTIFICATION_MESSAGE" 2>/dev/null || true',
            timeout: 3000,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // Note: PermissionRequest is NOT a valid Claude Code hook type
  // Auto-allow behavior is configured via settings.permissions.allow instead

  return hooks;
}

/**
 * Generate settings.json as formatted string
 */
export function generateSettingsJson(options: InitOptions): string {
  const settings = generateSettings(options);
  return JSON.stringify(settings, null, 2);
}
