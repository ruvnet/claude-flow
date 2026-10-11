/**
 * Settings.json Generator
 * Creates .claude/settings.json with V3-optimized hook configurations
 */

import type { InitOptions, HooksConfig, PlatformInfo } from './types.js';
import { detectPlatform } from './types.js';
import { helperHookCommand, helperScopeFor, helperStatusLineCommand, type HelperScope } from './helper-commands.js';

/**
 * Generate the complete settings.json content
 */
export function generateSettings(options: InitOptions): object {
  const settings: Record<string, unknown> = {};

  // Add hooks if enabled. CRITICAL (#1744 #3): only emit the hooks block when
  // the helpers directory will also be bundled. The hook commands point at
  // .claude/helpers/hook-handler.cjs; if that file isn't created (as in
  // --minimal where components.helpers=false), every hook fires and silently
  // fails to find its handler. Either bundle the helpers OR drop the hooks —
  // the option this fix takes is the latter (minimal stays minimal).
  if (options.components.settings && options.components.helpers) {
    settings.hooks = generateHooksConfig(options.hooks, helperScopeFor(options.targetDir));
  }

  // Add statusLine configuration if enabled
  if (options.statusline.enabled) {
    settings.statusLine = generateStatusLineConfig(options);
  }

  // Add permissions
  settings.permissions = {
    allow: [
      'Bash(npx @claude-flow*)',
      'Bash(npx claude-flow*)',
      'Bash(node .claude/*)',
      'mcp__claude-flow__*',
    ],
    deny: [
      'Read(./.env)',
      'Read(./.env.*)',
    ],
  };

  // #1670 — RuFlo attribution (Co-Authored-By trailer + PR footer) is now
  // OPT-IN. Default behavior no longer injects a third-party Co-Authored-By
  // line into the user's commits — that pattern silently inflated GitHub
  // contributor graphs and was hard to undo without rewriting history. Pass
  // `--attribution` (or `attribution: true` in InitOptions) to enable.
  //
  // #2078 — when the user DOES opt in, write a no-reply bot email so GitHub
  // treats this as a tool, not a personal contribution. Personal emails get
  // added to user repos' contributor graphs even when the trailer is opt-in.
  // `ruflo-bot@users.noreply.github.com` is GitHub's no-reply convention and
  // is excluded from contributor graphs / mapped to a tool identity.
  if (options.attribution === true) {
    settings.attribution = {
      commit: 'Co-Authored-By: ruflo-bot <ruflo-bot@users.noreply.github.com>',
      pr: '🤖 Generated with [RuFlo](https://github.com/ruvnet/ruflo)',
    };
  }

  // #3527: deliberately no settings.model. Project settings outrank the user's
  // own settings, so a pin here would silently override the model the user chose.
  // Ruflo's own routing preferences live in claudeFlow.modelPreferences below.

  // Add Agent Teams configuration (experimental feature)
  settings.env = {
    // Enable Claude Code Agent Teams for multi-agent coordination
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    // Claude Flow specific environment
    CLAUDE_FLOW_V3_ENABLED: 'true',
    CLAUDE_FLOW_HOOKS_ENABLED: 'true',
  };

  // Detect platform for platform-aware configuration
  const platform = detectPlatform();

  // Add V3-specific settings
  settings.claudeFlow = {
    version: '3.0.0',
    enabled: true,
    platform: {
      os: platform.os,
      arch: platform.arch,
      shell: platform.shell,
    },
    modelPreferences: {
      default: 'claude-sonnet-5',
      routing: 'claude-haiku-4-5-20251001',
    },
    agentTeams: {
      enabled: true,
      teammateMode: 'auto', // 'auto' | 'in-process' | 'tmux'
      taskListEnabled: true,
      mailboxEnabled: true,
      coordination: {
        // #3031: Liveness alone is not authority. Keep idle assignment off
        // until the scheduler can prove task ownership, agent scope, and a
        // refusal/back-off state. Users may explicitly opt in after supplying
        // those controls in their host configuration.
        autoAssignOnIdle: false,
        trainPatternsOnComplete: true, // Train neural patterns when tasks complete
        notifyLeadOnComplete: true,   // Notify team lead when tasks complete
        sharedMemoryNamespace: 'agent-teams', // Memory namespace for team coordination
      },
      hooks: {
        teammateIdle: {
          enabled: true,
          autoAssign: false,
          checkTaskList: true,
        },
        taskCompleted: {
          enabled: true,
          trainPatterns: true,
          notifyLead: true,
        },
      },
    },
    swarm: {
      topology: options.runtime.topology,
      maxAgents: options.runtime.maxAgents,
    },
    memory: {
      backend: options.runtime.memoryBackend,
      enableHNSW: options.runtime.enableHNSW,
      learningBridge: { enabled: options.runtime.enableLearningBridge ?? true },
      memoryGraph: { enabled: options.runtime.enableMemoryGraph ?? true },
      agentScopes: { enabled: options.runtime.enableAgentScopes ?? true },
    },
    neural: {
      enabled: options.runtime.enableNeural,
    },
    daemon: {
      autoStart: false,  // Opt-in only — prevents unintended token consumption (#1427, #1330)
      workers: [
        'map',           // Codebase mapping
        'audit',         // Security auditing (critical priority)
        'optimize',      // Performance optimization (high priority)
      ],
      schedules: {
        audit: { interval: '4h', priority: 'critical' },
        optimize: { interval: '2h', priority: 'high' },
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
 * Build a hook command that resolves to the right helpers dir for where the
 * settings live (#1943). Project-level settings probe the project's helpers
 * first and fall back to `$HOME/.claude/helpers`; user-level settings
 * (`~/.claude/settings.json`) apply to every opened project, so they are
 * pinned to `$HOME/.claude/helpers`. See helper-commands.ts.
 */
function hookCmd(script: string, subcommand: string, scope: HelperScope): string {
  return helperHookCommand(script, subcommand, scope);
}

/** Shorthand for CJS hook-handler commands */
function hookHandlerCmd(subcommand: string, scope: HelperScope): string {
  return hookCmd('.claude/helpers/hook-handler.cjs', subcommand, scope);
}

/** Shorthand for ESM auto-memory-hook commands */
function autoMemoryCmd(subcommand: string, scope: HelperScope): string {
  return hookCmd('.claude/helpers/auto-memory-hook.mjs', subcommand, scope);
}

/**
 * Generate statusLine configuration for Claude Code
 * Uses local helper script for cross-platform compatibility (no npx cold-start).
 * Claude Code pipes JSON session data to the script via stdin; valid fields
 * are type, command and padding. Platform handling (#1948, #1973) lives in
 * helperStatusLineCommand().
 */
function generateStatusLineConfig(options: InitOptions): object {
  return {
    type: 'command',
    command: helperStatusLineCommand(helperScopeFor(options.targetDir)),
  };
}

/**
 * Generate hooks configuration
 * Uses local hook-handler.cjs for cross-platform compatibility.
 * All hooks invoke scripts directly via `node <script> <subcommand>`,
 * working identically on Windows, macOS, and Linux.
 */
function generateHooksConfig(config: HooksConfig, scope: HelperScope): object {
  const hooks: Record<string, unknown[]> = {};

  // Node.js scripts handle errors internally via try/catch.
  // No shell-level error suppression needed (2>/dev/null || true breaks Windows).

  // PreToolUse — validate commands and edits before execution
  if (config.preToolUse) {
    hooks.PreToolUse = [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('pre-bash', scope),
            timeout: config.timeout,
          },
        ],
      },
      {
        matcher: 'Write|Edit|MultiEdit',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('pre-edit', scope),
            timeout: config.timeout,
          },
        ],
      },
    ];
  }

  // PostToolUse — record edits and commands for session metrics / learning
  if (config.postToolUse) {
    hooks.PostToolUse = [
      {
        matcher: 'Write|Edit|MultiEdit',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('post-edit', scope),
            timeout: 10000,
          },
        ],
      },
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('post-bash', scope),
            timeout: config.timeout,
          },
        ],
      },
    ];
  }

  // UserPromptSubmit — intelligent task routing
  if (config.userPromptSubmit) {
    hooks.UserPromptSubmit = [
      {
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('route', scope),
            timeout: 10000,
          },
        ],
      },
    ];
  }

  // SessionStart — restore session state + import auto memory
  if (config.sessionStart) {
    hooks.SessionStart = [
      {
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('session-restore', scope),
            timeout: 15000,
          },
          {
            type: 'command',
            command: autoMemoryCmd('import', scope),
            timeout: 8000,
          },
        ],
      },
    ];
  }

  // SessionEnd — persist session state
  if (config.sessionStart) {
    hooks.SessionEnd = [
      {
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('session-end', scope),
            timeout: 10000,
          },
        ],
      },
    ];
  }

  // Stop — sync auto memory on exit
  if (config.stop) {
    hooks.Stop = [
      {
        hooks: [
          {
            type: 'command',
            command: autoMemoryCmd('sync', scope),
            timeout: 10000,
          },
        ],
      },
    ];
  }

  // PreCompact — preserve context before compaction
  if (config.preCompact) {
    hooks.PreCompact = [
      {
        matcher: 'manual',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('compact-manual', scope),
          },
          {
            type: 'command',
            command: hookHandlerCmd('session-end', scope),
            timeout: 5000,
          },
        ],
      },
      {
        matcher: 'auto',
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('compact-auto', scope),
          },
          {
            type: 'command',
            command: hookHandlerCmd('session-end', scope),
            timeout: 6000,
          },
        ],
      },
    ];
  }

  // SubagentStart — status update when a sub-agent is spawned
  hooks.SubagentStart = [
    {
      hooks: [
        {
          type: 'command',
          command: hookHandlerCmd('status', scope),
          timeout: 3000,
        },
      ],
    },
  ];

  // SubagentStop — track agent completion for metrics
  // NOTE: The valid event is "SubagentStop" (not "SubagentEnd")
  hooks.SubagentStop = [
    {
      hooks: [
        {
          type: 'command',
          command: hookHandlerCmd('post-task', scope),
          timeout: 5000,
        },
      ],
    },
  ];

  // Notification — capture Claude Code notifications for logging
  if (config.notification) {
    hooks.Notification = [
      {
        hooks: [
          {
            type: 'command',
            command: hookHandlerCmd('notify', scope),
            timeout: 3000,
          },
        ],
      },
    ];
  }

  // NOTE: TeammateIdle, TaskCompleted, and PostCompact are NOT accepted by
  // Claude Code's settings.json validator (rejected as "Invalid key in record").
  // Agent Teams coordination lives in claudeFlow.agentTeams.hooks instead.

  return hooks;
}

/**
 * Generate settings.json as formatted string
 */
export function generateSettingsJson(options: InitOptions): string {
  const settings = generateSettings(options);
  return JSON.stringify(settings, null, 2);
}
