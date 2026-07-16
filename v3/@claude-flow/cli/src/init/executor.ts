/**
 * Init Executor
 * Main execution logic for V3 initialization
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { dirname } from 'path';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import type { InitOptions, InitResult, PlatformInfo } from './types.js';
import { detectPlatform, DEFAULT_INIT_OPTIONS } from './types.js';
import { generateSettingsJson, generateSettings } from './settings-generator.js';
import { generateMCPJson } from './mcp-generator.js';
import { generateStatuslineScript, generateStatuslineHook } from './statusline-generator.js';
import {
  generatePreCommitHook,
  generatePostCommitHook,
  generateSessionManager,
  generateAgentRouter,
  generateMemoryHelper,
  generateHookHandler,
  generateIntelligenceStub,
  generateAutoMemoryHook,
  generateRufloHookCjs,
} from './helpers-generator.js';
import { getInstalledCliVersion, HELPERS_STAMP_FILE } from './helper-refresh.js';
import { generateClaudeMd } from './claudemd-generator.js';
import { recordMemoryPackagePath } from './memory-package-resolver.js';

/**
 * Skills to copy based on configuration
 */
const SKILLS_MAP: Record<string, string[]> = {
  core: [
    'swarm-orchestration',
    'swarm-advanced',
    'sparc-methodology',
    'hooks-automation',
    'pair-programming',
    'verification-quality',
    'stream-chain',
    'skill-builder',
  ],
  browser: ['browser'],  // agent-browser integration
  dualMode: ['dual-mode'],  // Claude Code + Codex hybrid execution
  agentdb: [
    'agentdb-advanced',
    'agentdb-learning',
    'agentdb-memory-patterns',
    'agentdb-optimization',
    'agentdb-vector-search',
    'reasoningbank-agentdb',
    'reasoningbank-intelligence',
  ],
  github: [
    'github-code-review',
    'github-multi-repo',
    'github-project-management',
    'github-release-management',
    'github-workflow-automation',
  ],
  flowNexus: [
    'flow-nexus-neural',
    'flow-nexus-platform',
    'flow-nexus-swarm',
  ],
  v3: [
    'v3-cli-modernization',
    'v3-core-implementation',
    'v3-ddd-architecture',
    'v3-integration-deep',
    'v3-mcp-optimization',
    'v3-memory-unification',
    'v3-performance-optimization',
    'v3-security-overhaul',
    'v3-swarm-coordination',
  ],
};

/**
 * Commands to copy based on configuration
 * ADR-128 Phase 4: every subdirectory under .claude/commands/ now has a
 * corresponding key. The flow-nexus/ dir was deleted (belongs to the plugin).
 * New substrate keys default true; opt-in keys (pair, training, stream-chain,
 * truth, verify) default false per ADR-128 §Phase 3 opt-in rationale.
 */
const COMMANDS_MAP: Record<string, string[]> = {
  core: ['claude-flow-help.md', 'claude-flow-swarm.md', 'claude-flow-memory.md'],
  analysis: ['analysis'],
  automation: ['automation'],
  github: ['github'],
  hooks: ['hooks'],
  monitoring: ['monitoring'],
  optimization: ['optimization'],
  sparc: ['sparc'],
  // ADR-128 Phase 4 promotions (previously orphaned)
  agents: ['agents'],
  coordination: ['coordination'],
  hiveMind: ['hive-mind'],
  memory: ['memory'],
  swarm: ['swarm'],
  workflows: ['workflows'],
  // Opt-in categories (non-universal; default false in CommandsConfig)
  pair: ['pair'],
  training: ['training'],
  streamChain: ['stream-chain'],
  truth: ['truth'],
  verify: ['verify'],
};

/**
 * Agents to copy based on configuration
 */
const AGENTS_MAP: Record<string, string[]> = {
  core: ['core'],
  consensus: ['consensus'],
  github: ['github'],
  hiveMind: ['hive-mind'],
  sparc: ['sparc'],
  swarm: ['swarm'],
  browser: ['browser'],  // agent-browser integration
  dualMode: ['dual-mode'],  // Claude Code + Codex hybrid execution
  // V3-specific agents
  v3: ['v3'],
  optimization: ['optimization'],
  templates: ['templates'],
  testing: ['testing'],
  sublinear: ['sublinear'],
  flowNexus: ['flow-nexus'],
  analysis: ['analysis'],
  architecture: ['architecture'],
  development: ['development'],
  devops: ['devops'],
  documentation: ['documentation'],
  specialized: ['specialized'],
  goal: ['goal'],
  sona: ['sona'],
  payments: ['payments'],
  data: ['data'],
  custom: ['custom'],
};

/**
 * Directory structure to create
 */
const DIRECTORIES = {
  claude: [
    '.claude',
    '.claude/skills',
    '.claude/commands',
    '.claude/agents',
    '.claude/helpers',
  ],
  runtime: [
    '.claude-flow',
    '.claude-flow/data',
    '.claude-flow/logs',
    '.claude-flow/sessions',
    '.claude-flow/hooks',
    '.claude-flow/agents',
    '.claude-flow/workflows',
  ],
};

/**
 * Execute initialization
 */
export async function executeInit(options: InitOptions): Promise<InitResult> {
  // Detect platform
  const platform = detectPlatform();

  const result: InitResult = {
    success: true,
    platform,
    created: {
      directories: [],
      files: [],
    },
    skipped: [],
    errors: [],
    summary: {
      skillsCount: 0,
      commandsCount: 0,
      agentsCount: 0,
      hooksEnabled: 0,
    },
  };

  const targetDir = options.targetDir;

  try {
    // Create directory structure
    await createDirectories(targetDir, options, result);

    // Generate and write settings.json
    if (options.components.settings) {
      await writeSettings(targetDir, options, result);
    }

    // Generate and write .mcp.json
    if (options.components.mcp) {
      await writeMCPConfig(targetDir, options, result);
    }

    // Copy skills
    if (options.components.skills) {
      await copySkills(targetDir, options, result);
    }

    // Copy commands
    if (options.components.commands) {
      await copyCommands(targetDir, options, result);
    }

    // Copy agents
    if (options.components.agents) {
      await copyAgents(targetDir, options, result);
    }

    // Generate helpers
    if (options.components.helpers) {
      await writeHelpers(targetDir, options, result);

      // #2545: The auto-memory hook needs @claude-flow/memory, which is an
      // optionalDependency of the CLI and lands in the npx cache — unreachable
      // by a node_modules walk-up from the user's project. Resolve it from the
      // CLI's own context now (where it IS present) and record the absolute
      // path in a machine-local sidecar the hook reads first. Best-effort:
      // when the optional dep is absent the hook fails loud and doctor flags it.
      const memRecord = recordMemoryPackagePath(targetDir, 'init');
      if (memRecord) {
        result.created.files.push('.claude-flow/memory-package.json');
      }

      // #2568-followup: if this project already has a memory DB that predates
      // the `vector_indexes` table (older CLI / agentdb-written), self-heal it
      // so the statusline vector count + namespace routing work. Best-effort,
      // dynamically imported so a WASM-only host without better-sqlite3 just
      // skips it.
      //
      // Persistent memory ON BY DEFAULT: `runtime.memoryBackend` already
      // defaults to 'hybrid' in DEFAULT_INIT_OPTIONS, but that only ever
      // configured the DECLARED backend — the actual .swarm/memory.db file
      // was never created until something eventually called `memory store`
      // or the user ran `memory init --force` by hand (both the generated
      // CLAUDE.md and the quickstart docs told users to do this as a
      // separate step). A fresh project could sit for days looking
      // "configured for AgentDB" while genuinely capturing nothing, with no
      // signal that the config and the on-disk reality had diverged. Fresh
      // projects now get the DB eagerly created here, matching what
      // `memoryBackend` already promised; MINIMAL_INIT_OPTIONS
      // (memoryBackend: 'memory') opts out, matching its non-persistent intent.
      try {
        const memDbPath = path.join(targetDir, '.swarm', 'memory.db');
        if (fs.existsSync(memDbPath)) {
          const { repairVectorIndexes } = await import('../memory/memory-initializer.js');
          await repairVectorIndexes(memDbPath, { autoRecover: true });
        } else if (options.runtime.memoryBackend !== 'memory') {
          const { initializeMemoryDatabase } = await import('../memory/memory-initializer.js');
          const initResult = await initializeMemoryDatabase({
            backend: options.runtime.memoryBackend,
            dbPath: memDbPath,
            verbose: false,
          });
          if (initResult.success) {
            result.created.files.push('.swarm/memory.db');
          }
        }
      } catch { /* best-effort — never block init on memory setup */ }
    }

    // Generate statusline
    if (options.components.statusline) {
      await writeStatusline(targetDir, options, result);
    }

    // Generate runtime config
    if (options.components.runtime) {
      await writeRuntimeConfig(targetDir, options, result);
    }

    // Create initial metrics for statusline (prevents "all zeros" display)
    if (options.components.statusline) {
      await writeInitialMetrics(targetDir, options, result);
    }

    // Generate CLAUDE.md
    if (options.components.claudeMd) {
      await writeClaudeMd(targetDir, options, result);
    }

    // Count enabled hooks
    result.summary.hooksEnabled = countEnabledHooks(options);

  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/**
 * Upgrade result interface
 */
export interface UpgradeResult {
  success: boolean;
  updated: string[];
  created: string[];
  preserved: string[];
  errors: string[];
  /** Added by --add-missing flag */
  addedSkills?: string[];
  addedAgents?: string[];
  addedCommands?: string[];
  /** Added by --settings flag */
  settingsUpdated?: string[];
}

/**
 * Merge new settings into existing settings.json
 * Preserves user customizations while adding new features like Agent Teams
 * Uses platform-specific commands for Mac, Linux, and Windows
 */
function mergeSettingsForUpgrade(existing: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...existing };
  const platform = detectPlatform();
  const isWindows = platform.os === 'windows';

  // Platform-specific command wrappers
  // Windows: Use PowerShell-compatible commands
  // Mac/Linux: Use bash-compatible commands with 2>/dev/null
  // NOTE: teammateIdleCmd and taskCompletedCmd were removed.
  // TeammateIdle/TaskCompleted are not valid Claude Code hook events and caused warnings.
  // Agent Teams hook config lives in claudeFlow.agentTeams.hooks instead.

  // 1. Merge env vars (preserve existing, add new)
  const existingEnv = (existing.env as Record<string, string>) || {};
  merged.env = {
    ...existingEnv,
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    CLAUDE_FLOW_V3_ENABLED: existingEnv.CLAUDE_FLOW_V3_ENABLED || 'true',
    CLAUDE_FLOW_HOOKS_ENABLED: existingEnv.CLAUDE_FLOW_HOOKS_ENABLED || 'true',
  };

  // 2. Merge hooks (preserve existing, add new Agent Teams + auto-memory hooks)
  const existingHooks = (existing.hooks as Record<string, unknown[]>) || {};
  merged.hooks = { ...existingHooks };

  // Cross-platform auto-memory hook commands that resolve paths via git root.
  // Uses node -e with git rev-parse so hooks work regardless of CWD (#1259, #1284).
  const gitRootResolver = "var c=require('child_process'),p=require('path'),u=require('url'),r;"
    + "try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}"
    + 'catch(e){r=process.cwd()}';
  const autoMemoryScript = '.claude/helpers/auto-memory-hook.mjs';
  const autoMemoryImportCmd = `node -e "${gitRootResolver}var f=p.join(r,'${autoMemoryScript}');import(u.pathToFileURL(f).href)" import`;
  const autoMemorySyncCmd = `node -e "${gitRootResolver}var f=p.join(r,'${autoMemoryScript}');import(u.pathToFileURL(f).href)" sync`;

  // Add auto-memory import to SessionStart (if not already present)
  const sessionStartHooks = existingHooks.SessionStart as Array<{ hooks?: Array<{ command?: string }> }> | undefined;
  const hasAutoMemoryImport = sessionStartHooks?.some(group =>
    group.hooks?.some(h => h.command?.includes('auto-memory-hook')));
  if (!hasAutoMemoryImport) {
    const startHooks = merged.hooks as Record<string, unknown[]>;
    if (!startHooks.SessionStart) {
      startHooks.SessionStart = [{ hooks: [] }];
    }
    const startGroup = startHooks.SessionStart[0] as { hooks: unknown[] };
    if (!startGroup.hooks) startGroup.hooks = [];
    startGroup.hooks.push({
      type: 'command',
      command: autoMemoryImportCmd,
      timeout: 6000,
      continueOnError: true,
    });
  }

  // Add auto-memory sync to SessionEnd (if not already present)
  const sessionEndHooks = existingHooks.SessionEnd as Array<{ hooks?: Array<{ command?: string }> }> | undefined;
  const hasAutoMemorySync = sessionEndHooks?.some(group =>
    group.hooks?.some(h => h.command?.includes('auto-memory-hook')));
  if (!hasAutoMemorySync) {
    const endHooks = merged.hooks as Record<string, unknown[]>;
    if (!endHooks.SessionEnd) {
      endHooks.SessionEnd = [{ hooks: [] }];
    }
    const endGroup = endHooks.SessionEnd[0] as { hooks: unknown[] };
    if (!endGroup.hooks) endGroup.hooks = [];
    // Insert at beginning so sync runs before other cleanup
    endGroup.hooks.unshift({
      type: 'command',
      command: autoMemorySyncCmd,
      timeout: 8000,
      continueOnError: true,
    });
  }

  // NOTE: TeammateIdle and TaskCompleted are NOT valid Claude Code hook events.
  // They cause warnings when present in settings.json hooks.
  // Remove them if they exist from a previous init.
  delete (merged.hooks as Record<string, unknown>).TeammateIdle;
  delete (merged.hooks as Record<string, unknown>).TaskCompleted;
  // Their configuration lives in claudeFlow.agentTeams.hooks instead.

  // 3. Fix statusLine config (remove invalid fields, ensure correct format)
  // Claude Code only supports: type, command, padding
  //
  // #2448 — Detect and REGENERATE the runaway `npx @claude-flow/cli@latest`
  // statusline form. Pre-#2337 init wrote this to settings.json; it spawns
  // a cold Node process + npm registry round-trip on every fire (statusline
  // refires every few hundred ms), which on macOS produced load average 49
  // / jetsam / kernel panic. Preserving the user's existing command (the
  // old behavior here) means anyone who installed pre-#2337 and upgraded
  // never gets the fix. Now we detect the broken form and overwrite.
  const NEW_STATUSLINE_CMD =
    `node -e "var c=require('child_process'),p=require('path'),r;try{r=c.execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim()}catch(e){r=process.cwd()}var s=p.join(r,'.claude/helpers/statusline.cjs');process.argv.splice(1,0,s);require(s)"`;
  // Matches any invocation of `claude-flow hooks statusline` — either via npx
  // (`npx [--prefer-offline] [@]claude-flow[/cli][@<tag>] hooks statusline …`)
  // or as a bare command (`claude-flow hooks statusline …`). Both forms cold-
  // load the ONNX model on every fire (~1s); Claude Code times out and hides
  // the status bar (#2450). The migration replaces the whole command with
  // NEW_STATUSLINE_CMD which invokes the local helper directly via `node -e`.
  // Flag-list repetition bounded at 10 (real invocations never carry more) —
  // an unbounded `*` here is exponential-backtracking-prone (CodeQL
  // js/redos): a crafted settings.json command string with dozens of
  // dash-token repetitions can hang this check for minutes.
  const BROKEN_STATUSLINE_RE = /(?:npx\s+(?:--?\S+\s+){0,10})?@?claude-flow(?:\/cli)?(?:@\S+)?\s+hooks\s+statusline/;
  const existingStatusLine = existing.statusLine as Record<string, unknown> | undefined;
  if (existingStatusLine) {
    const existingCmd = typeof existingStatusLine.command === 'string' ? existingStatusLine.command : '';
    const isBroken = BROKEN_STATUSLINE_RE.test(existingCmd);
    merged.statusLine = {
      type: 'command',
      command: isBroken || !existingCmd ? NEW_STATUSLINE_CMD : existingCmd,
      // Remove invalid fields: refreshMs, enabled (not supported by Claude Code)
    };
  }

  // #2448 — Detect and REGENERATE per-action hook commands that still use
  // the runaway `npx @claude-flow/cli@latest hooks <sub>` form. These fire
  // on every PreToolUse/PostToolUse/UserPromptSubmit, each spawning ~130 MB
  // of cold Node + npm registry resolution; the storm is what kernel-paniced
  // the reporter's machine in #2448.
  //
  // We walk each hook event's `hooks[]` and swap any command matching the
  // broken pattern for the local-helper form. Idempotent: re-running this
  // migration on already-correct settings is a no-op.
  // Bounded for the same reason as BROKEN_STATUSLINE_RE above (CodeQL js/redos).
  const BROKEN_HOOK_RE = /npx\s+(?:--?\S+\s+){0,10}@?claude-flow\/cli@latest\s+hooks\s+(\S+)/;
  const localHookCmd = (sub: string): string => {
    // POSIX form mirrors settings-generator.ts::hookCmd() exactly.
    // Windows users hit a separate code path (cmd /c …) — Claude Code on
    // Windows is rarer and the migration there is left to a follow-up.
    if (process.platform === 'win32') {
      return `cmd /c "IF EXIST \"%CLAUDE_PROJECT_DIR%\\.claude\\helpers\\hook-handler.cjs\" (node \"%CLAUDE_PROJECT_DIR%\\.claude\\helpers\\hook-handler.cjs\" ${sub}) ELSE (node \"%USERPROFILE%\\.claude\\helpers\\hook-handler.cjs\" ${sub})"`;
    }
    return `sh -c 'D="\${CLAUDE_PROJECT_DIR:-.}"; [ -f "$D/.claude/helpers/hook-handler.cjs" ] || D="\${HOME}"; exec node "$D/.claude/helpers/hook-handler.cjs" ${sub}'`;
  };
  const mergedHooks = merged.hooks as Record<string, unknown> | undefined;
  if (mergedHooks) {
    for (const eventName of Object.keys(mergedHooks)) {
      const groups = mergedHooks[eventName] as Array<{ hooks?: Array<{ type?: string; command?: string; timeout?: number }> }> | undefined;
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!Array.isArray(group.hooks)) continue;
        for (const h of group.hooks) {
          if (typeof h?.command !== 'string') continue;
          const m = BROKEN_HOOK_RE.exec(h.command);
          if (!m) continue;
          // Subcommand captured (e.g. "pre-bash", "post-edit", "route") — keep it.
          h.command = localHookCmd(m[1]);
        }
      }
    }
  }

  // 4. Merge claudeFlow settings (preserve existing, add agentTeams + memory)
  const existingClaudeFlow = (existing.claudeFlow as Record<string, unknown>) || {};
  const existingMemory = (existingClaudeFlow.memory as Record<string, unknown>) || {};
  merged.claudeFlow = {
    ...existingClaudeFlow,
    version: existingClaudeFlow.version || '3.0.0',
    enabled: existingClaudeFlow.enabled !== false,
    agentTeams: {
      enabled: true,
      teammateMode: 'auto',
      taskListEnabled: true,
      mailboxEnabled: true,
      coordination: {
        autoAssignOnIdle: true,
        trainPatternsOnComplete: true,
        notifyLeadOnComplete: true,
        sharedMemoryNamespace: 'agent-teams',
      },
      hooks: {
        teammateIdle: { enabled: true, autoAssign: true, checkTaskList: true },
        taskCompleted: { enabled: true, trainPatterns: true, notifyLead: true },
      },
    },
    memory: {
      ...existingMemory,
      learningBridge: existingMemory.learningBridge ?? { enabled: true },
      memoryGraph: existingMemory.memoryGraph ?? { enabled: true },
      agentScopes: existingMemory.agentScopes ?? { enabled: true },
    },
  };

  return merged;
}

/**
 * Execute upgrade - updates helpers and creates missing metrics without losing data
 * This is safe for existing users who want the latest statusline fixes
 * @param targetDir - Target directory
 * @param upgradeSettings - If true, merge new settings into existing settings.json
 */
export async function executeUpgrade(targetDir: string, upgradeSettings = false): Promise<UpgradeResult> {
  const result: UpgradeResult = {
    success: true,
    updated: [],
    created: [],
    preserved: [],
    errors: [],
    settingsUpdated: [],
  };

  try {
    // Ensure required directories exist
    const dirs = [
      '.claude/helpers',
      '.claude-flow/metrics',
      '.claude-flow/security',
      '.claude-flow/learning',
    ];

    for (const dir of dirs) {
      const fullPath = path.join(targetDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    // 0. ALWAYS update critical helpers (force overwrite)
    const sourceHelpersForUpgrade = findSourceHelpersDir();
    if (sourceHelpersForUpgrade) {
      // Keep in sync with helper-refresh.ts:CRITICAL_HELPERS.
      const criticalHelpers = ['auto-memory-hook.mjs', 'hook-handler.cjs', 'intelligence.cjs', 'statusline.cjs'];
      for (const helperName of criticalHelpers) {
        const targetPath = path.join(targetDir, '.claude', 'helpers', helperName);
        const sourcePath = path.join(sourceHelpersForUpgrade, helperName);
        if (fs.existsSync(sourcePath)) {
          if (fs.existsSync(targetPath)) {
            result.updated.push(`.claude/helpers/${helperName}`);
          } else {
            result.created.push(`.claude/helpers/${helperName}`);
          }
          fs.copyFileSync(sourcePath, targetPath);
          try { fs.chmodSync(targetPath, '755'); } catch {}
        }
      }
    } else {
      // Source not found (npx with broken paths) — use generated fallbacks
      const generatedCritical: Record<string, string> = {
        'hook-handler.cjs': generateHookHandler(),
        'intelligence.cjs': generateIntelligenceStub(),
        'auto-memory-hook.mjs': generateAutoMemoryHook(),
      };
      for (const [helperName, content] of Object.entries(generatedCritical)) {
        const targetPath = path.join(targetDir, '.claude', 'helpers', helperName);
        if (fs.existsSync(targetPath)) {
          result.updated.push(`.claude/helpers/${helperName}`);
        } else {
          result.created.push(`.claude/helpers/${helperName}`);
        }
        fs.writeFileSync(targetPath, content, 'utf-8');
        try { fs.chmodSync(targetPath, '755'); } catch {}
      }
    }

    // Stamp the installed version so the startup auto-refresh treats these as
    // current (no redundant re-copy on the next command).
    try {
      fs.writeFileSync(
        path.join(targetDir, '.claude', 'helpers', HELPERS_STAMP_FILE),
        getInstalledCliVersion(), 'utf-8',
      );
    } catch { /* non-fatal */ }

    // #2545: (re)record the resolved @claude-flow/memory path so the auto-memory
    // hook can find it on the npx install path. Best-effort — see executeInit.
    const memRecord = recordMemoryPackagePath(targetDir, 'upgrade');
    if (memRecord) {
      result.updated.push('.claude-flow/memory-package.json');
    }

    // 1. ALWAYS update statusline helper (force overwrite)
    const statuslinePath = path.join(targetDir, '.claude', 'helpers', 'statusline.cjs');
    // Use default options with statusline config
    const upgradeOptions: InitOptions = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir,
      force: true,
      statusline: {
        ...DEFAULT_INIT_OPTIONS.statusline,
        refreshInterval: 5000,
      },
    };
    const statuslineContent = generateStatuslineScript(upgradeOptions);

    if (fs.existsSync(statuslinePath)) {
      result.updated.push('.claude/helpers/statusline.cjs');
    } else {
      result.created.push('.claude/helpers/statusline.cjs');
    }
    fs.writeFileSync(statuslinePath, statuslineContent, 'utf-8');

    // 2. Create MISSING metrics files only (preserve existing data)
    const metricsDir = path.join(targetDir, '.claude-flow', 'metrics');
    const securityDir = path.join(targetDir, '.claude-flow', 'security');

    // v3-progress.json
    const progressPath = path.join(metricsDir, 'v3-progress.json');
    if (!fs.existsSync(progressPath)) {
      const progress = {
        version: '3.0.0',
        initialized: new Date().toISOString(),
        domains: { completed: 0, total: 5, status: 'INITIALIZING' },
        ddd: { progress: 0, modules: 0, totalFiles: 0, totalLines: 0 },
        swarm: { activeAgents: 0, maxAgents: 15, topology: 'hierarchical-mesh' },
        learning: { status: 'READY', patternsLearned: 0, sessionsCompleted: 0 },
        _note: 'Metrics will update as you use Ruflo'
      };
      fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
      result.created.push('.claude-flow/metrics/v3-progress.json');
    } else {
      result.preserved.push('.claude-flow/metrics/v3-progress.json');
    }

    // swarm-activity.json
    const activityPath = path.join(metricsDir, 'swarm-activity.json');
    if (!fs.existsSync(activityPath)) {
      const activity = {
        timestamp: new Date().toISOString(),
        processes: { agentic_flow: 0, mcp_server: 0, estimated_agents: 0 },
        swarm: { active: false, agent_count: 0, coordination_active: false },
        integration: { agentic_flow_active: false, mcp_active: false },
        _initialized: true
      };
      fs.writeFileSync(activityPath, JSON.stringify(activity, null, 2), 'utf-8');
      result.created.push('.claude-flow/metrics/swarm-activity.json');
    } else {
      result.preserved.push('.claude-flow/metrics/swarm-activity.json');
    }

    // learning.json
    const learningPath = path.join(metricsDir, 'learning.json');
    if (!fs.existsSync(learningPath)) {
      const learning = {
        initialized: new Date().toISOString(),
        routing: { accuracy: 0, decisions: 0 },
        patterns: { shortTerm: 0, longTerm: 0, quality: 0 },
        sessions: { total: 0, current: null },
        _note: 'Intelligence grows as you use Ruflo'
      };
      fs.writeFileSync(learningPath, JSON.stringify(learning, null, 2), 'utf-8');
      result.created.push('.claude-flow/metrics/learning.json');
    } else {
      result.preserved.push('.claude-flow/metrics/learning.json');
    }

    // audit-status.json
    const auditPath = path.join(securityDir, 'audit-status.json');
    if (!fs.existsSync(auditPath)) {
      const audit = {
        initialized: new Date().toISOString(),
        status: 'PENDING',
        cvesFixed: 0,
        totalCves: 0,
        lastScan: null,
        _note: 'Run: npx @claude-flow/cli@latest security scan'
      };
      fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf-8');
      result.created.push('.claude-flow/security/audit-status.json');
    } else {
      result.preserved.push('.claude-flow/security/audit-status.json');
    }

    // 3. Merge settings if requested
    if (upgradeSettings) {
      const settingsPath = path.join(targetDir, '.claude', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        try {
          const existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          const mergedSettings = mergeSettingsForUpgrade(existingSettings);
          fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8');
          result.updated.push('.claude/settings.json');
          result.settingsUpdated = [
            'env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
            'hooks.SessionStart (auto-memory import)',
            'hooks.SessionEnd (auto-memory sync)',
            'hooks.TeammateIdle (removed — not a valid Claude Code hook)',
            'hooks.TaskCompleted (removed — not a valid Claude Code hook)',
            'claudeFlow.agentTeams',
            'claudeFlow.memory (learningBridge, memoryGraph, agentScopes)',
          ];
        } catch (settingsError) {
          result.errors.push(`Settings merge failed: ${settingsError instanceof Error ? settingsError.message : String(settingsError)}`);
        }
      } else {
        // Create new settings.json with defaults
        const defaultSettings = generateSettings(DEFAULT_INIT_OPTIONS);
        fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2), 'utf-8');
        result.created.push('.claude/settings.json');
        result.settingsUpdated = ['Created new settings.json with Agent Teams'];
      }
    }

  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/**
 * Execute upgrade with --add-missing flag
 * Adds any new skills, agents, and commands that don't exist yet
 * @param targetDir - Target directory
 * @param upgradeSettings - If true, merge new settings into existing settings.json
 */
export async function executeUpgradeWithMissing(targetDir: string, upgradeSettings = false): Promise<UpgradeResult> {
  // First do the normal upgrade (pass through upgradeSettings)
  const result = await executeUpgrade(targetDir, upgradeSettings);

  if (!result.success) {
    return result;
  }

  // Initialize tracking arrays
  result.addedSkills = [];
  result.addedAgents = [];
  result.addedCommands = [];

  try {
    // Ensure target directories exist
    const skillsDir = path.join(targetDir, '.claude', 'skills');
    const agentsDir = path.join(targetDir, '.claude', 'agents');
    const commandsDir = path.join(targetDir, '.claude', 'commands');

    for (const dir of [skillsDir, agentsDir, commandsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Find source directories
    const sourceSkillsDir = findSourceDir('skills');
    const sourceAgentsDir = findSourceDir('agents');
    const sourceCommandsDir = findSourceDir('commands');

    // Debug: Log source directories found
    if (process.env.DEBUG || process.env.CLAUDE_FLOW_DEBUG) {
      console.log('[DEBUG] Source directories:');
      console.log(`  Skills: ${sourceSkillsDir || 'NOT FOUND'}`);
      console.log(`  Agents: ${sourceAgentsDir || 'NOT FOUND'}`);
      console.log(`  Commands: ${sourceCommandsDir || 'NOT FOUND'}`);
    }

    // Add missing skills
    if (sourceSkillsDir) {
      const allSkills = Object.values(SKILLS_MAP).flat();
      const debugMode = process.env.DEBUG || process.env.CLAUDE_FLOW_DEBUG;
      if (debugMode) {
        console.log(`[DEBUG] Checking ${allSkills.length} skills from SKILLS_MAP`);
      }
      for (const skillName of [...new Set(allSkills)]) {
        const sourcePath = path.join(sourceSkillsDir, skillName);
        const targetPath = path.join(skillsDir, skillName);
        const sourceExists = fs.existsSync(sourcePath);
        const targetExists = fs.existsSync(targetPath);

        if (debugMode) {
          console.log(`[DEBUG] Skill '${skillName}': source=${sourceExists}, target=${targetExists}`);
        }

        if (sourceExists && !targetExists) {
          copyDirRecursive(sourcePath, targetPath);
          result.addedSkills.push(skillName);
          result.created.push(`.claude/skills/${skillName}`);
        }
      }
    }

    // Add missing agents
    if (sourceAgentsDir) {
      const allAgents = Object.values(AGENTS_MAP).flat();
      for (const agentCategory of [...new Set(allAgents)]) {
        const sourcePath = path.join(sourceAgentsDir, agentCategory);
        const targetPath = path.join(agentsDir, agentCategory);

        if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
          copyDirRecursive(sourcePath, targetPath);
          result.addedAgents.push(agentCategory);
          result.created.push(`.claude/agents/${agentCategory}`);
        }
      }
    }

    // Add missing commands
    if (sourceCommandsDir) {
      const allCommands = Object.values(COMMANDS_MAP).flat();
      for (const cmdName of [...new Set(allCommands)]) {
        const sourcePath = path.join(sourceCommandsDir, cmdName);
        const targetPath = path.join(commandsDir, cmdName);

        if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
          if (fs.statSync(sourcePath).isDirectory()) {
            copyDirRecursive(sourcePath, targetPath);
          } else {
            fs.copyFileSync(sourcePath, targetPath);
          }
          result.addedCommands.push(cmdName);
          result.created.push(`.claude/commands/${cmdName}`);
        }
      }
    }

  } catch (error) {
    result.errors.push(`Add missing failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

/**
 * Create directory structure
 */
async function createDirectories(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const dirs = [
    ...DIRECTORIES.claude,
    ...(options.components.runtime ? DIRECTORIES.runtime : []),
  ];

  for (const dir of dirs) {
    const fullPath = path.join(targetDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      result.created.directories.push(dir);
    }
  }
}

/**
 * Write settings.json
 */
async function writeSettings(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  const generated = JSON.parse(generateSettingsJson(options));

  if (fs.existsSync(settingsPath) && !options.force) {
    // Merge hooks/env/permissions into existing settings instead of skipping
    try {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      let merged = false;

      // Merge hooks (the critical missing piece — #1484)
      if (generated.hooks && !existing.hooks) {
        existing.hooks = generated.hooks;
        merged = true;
      }

      // Merge env vars (for CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS etc.)
      if (generated.env) {
        existing.env = { ...(existing.env || {}), ...generated.env };
        merged = true;
      }

      // Merge permissions (add ruflo allow rules)
      if (generated.permissions?.allow) {
        const existingAllow = existing.permissions?.allow || [];
        const newRules = generated.permissions.allow.filter(
          (r: string) => !existingAllow.includes(r)
        );
        if (newRules.length > 0) {
          existing.permissions = existing.permissions || {};
          existing.permissions.allow = [...existingAllow, ...newRules];
          merged = true;
        }
      }

      if (merged) {
        fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2), 'utf-8');
        result.created.files.push('.claude/settings.json (merged hooks)');
      } else {
        result.skipped.push('.claude/settings.json');
      }
    } catch {
      // Existing file is corrupt — overwrite
      fs.writeFileSync(settingsPath, JSON.stringify(generated, null, 2), 'utf-8');
      result.created.files.push('.claude/settings.json');
    }
    return;
  }

  fs.writeFileSync(settingsPath, JSON.stringify(generated, null, 2), 'utf-8');
  result.created.files.push('.claude/settings.json');
}

/**
 * #1779 — Walk parents of `targetDir` plus the user-global Claude Code
 * config locations, looking for any `.mcp.json` (or `~/.claude.json`)
 * that already declares a `ruflo`-keyed MCP server. We use this to skip
 * writing our own `claude-flow`-keyed entry when the user has already
 * registered the same binary under the new name — that's exactly the
 * "same MCP server twice under two different prefixes" duplication the
 * issue describes.
 *
 * Returns the path of the file that already declares `ruflo`/`claude-flow` (so we can
 * surface it in the skipped-message), or null if none found.
 */
function detectExistingRufloMCP(targetDir: string): string | null {
  const home = (process.env.HOME ?? process.env.USERPROFILE) ?? '';
  const candidates = new Set<string>();
  // User-global Claude Code config locations
  if (home) {
    candidates.add(path.join(home, '.claude.json'));
    candidates.add(path.join(home, '.claude', 'mcp.json'));
  }
  // Walk parents of targetDir up to root, checking for .mcp.json at each
  const targetResolved = path.resolve(targetDir);
  let dir = targetResolved;
  const targetAncestors = new Set<string>();
  while (true) {
    candidates.add(path.join(dir, '.mcp.json'));
    targetAncestors.add(normalizeProjectKey(dir));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Skip the targetDir itself — that's the one we're about to write
  candidates.delete(path.join(targetResolved, '.mcp.json'));

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      if (!parsed || typeof parsed !== 'object') continue;
      // (a) Top-level mcpServers (legacy / global form).
      // Accept BOTH names so init does not add a second server for the same
      // binary when a project carries a pre-rename `claude-flow` registration
      // and the current generator would write `ruflo` (#2612).
      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        const servers = parsed.mcpServers as Record<string, unknown>;
        // #2369: also recognise the legacy dist-tag keys generated by
        // pre-rename installs (claude-flow ≤ 2.x). Without these the
        // detection walks parent dirs, doesn't match, and writes a NEW
        // claude-flow-keyed config — both servers then run under
        // different prefixes producing duplicate-tool noise.
        if (
          'claude-flow' in servers ||
          'ruflo' in servers ||
          'claude-flow@alpha' in servers ||
          'claude-flow@v3alpha' in servers
        ) return candidate;
      }
      // (b) #1840: Claude Code project-scoped registrations under
      //     parsed.projects[<projectPath>].mcpServers. Match by
      //     normalized path against targetDir or any of its ancestors so an
      //     existing `claude-flow` or `ruflo` registration in this repo is
      //     detected even when Claude stored the key with different casing/slash style.
      if (parsed.projects && typeof parsed.projects === 'object') {
        for (const [projectKey, projectVal] of Object.entries(parsed.projects)) {
          if (!projectVal || typeof projectVal !== 'object') continue;
          const projectMcp = (projectVal as { mcpServers?: unknown }).mcpServers;
          if (!projectMcp || typeof projectMcp !== 'object') continue;
          const mcp = projectMcp as Record<string, unknown>;
          // #2369: legacy dist-tag keys also count as already-registered.
          if (
            !('claude-flow' in mcp) &&
            !('ruflo' in mcp) &&
            !('claude-flow@alpha' in mcp) &&
            !('claude-flow@v3alpha' in mcp)
          ) continue;
          if (targetAncestors.has(normalizeProjectKey(projectKey))) {
            return `${candidate} (projects[${projectKey}])`;
          }
        }
      }
    } catch { /* malformed JSON — ignore */ }
  }
  return null;
}

/**
 * Normalize a project path key for cross-platform comparison.
 * Claude Code stores Windows paths like "C:/Users/.../Project" while
 * Node's `path.resolve()` may emit "C:\Users\...\Project". Lowercase +
 * forward-slash gives a stable comparison key on both platforms.
 */
function normalizeProjectKey(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

/**
 * Write .mcp.json
 */
async function writeMCPConfig(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const mcpPath = path.join(targetDir, '.mcp.json');

  if (fs.existsSync(mcpPath) && !options.force) {
    // #2369: an existing .mcp.json from a pre-rename install is the most
    // common cause of "autopilot tools missing after init" reports. Parse
    // the existing file and surface a loud, specific message naming the
    // stale key so users know to either delete the file or re-run with
    // --force. Without this they get a silent skip and no warning.
    try {
      const parsed = JSON.parse(fs.readFileSync(mcpPath, 'utf-8')) as { mcpServers?: Record<string, unknown> };
      const servers = parsed?.mcpServers;
      if (servers && typeof servers === 'object') {
        const staleKeys = ['claude-flow@alpha', 'claude-flow@v3alpha'].filter(k => k in servers);
        if (staleKeys.length > 0) {
          result.skipped.push(
            `.mcp.json (existing file uses deprecated key '${staleKeys[0]}' — autopilot/browser/wasm-agent tools will be missing; ` +
            `delete .mcp.json and re-run, or re-run with --force to overwrite)`
          );
          return;
        }
      }
    } catch {
      // Existing file isn't valid JSON — fall through to the generic skip.
    }
    result.skipped.push('.mcp.json');
    return;
  }

  // #1779/#2612 — Skip writing if the user already has this MCP server
  // registered elsewhere (parent .mcp.json, ~/.claude.json, etc). The
  // canonical key is `claude-flow` (per #2206 — matches mcp__claude-flow__*
  // plugin tool refs); a stray `ruflo`-keyed entry pointing at the same
  // binary is the legacy-duplicate form that #2612 healed. Writing our
  // fresh `claude-flow` entry on top of either variant starts the same
  // binary twice under two tool namespaces. Force-mode (`--force`)
  // bypasses this guard for users who actually want both registrations.
  if (!options.force) {
    const existingRufloPath = detectExistingRufloMCP(targetDir);
    if (existingRufloPath) {
      result.skipped.push(`.mcp.json (existing ruflo/claude-flow MCP registration found at ${existingRufloPath} — would create duplicate; pass --force to write anyway)`);
      return;
    }
  }

  const content = generateMCPJson(options);
  fs.writeFileSync(mcpPath, content, 'utf-8');
  result.created.files.push('.mcp.json');
}

/**
 * Copy skills from source
 */
async function copySkills(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const skillsConfig = options.skills;
  const targetSkillsDir = path.join(targetDir, '.claude', 'skills');

  // Determine which skills to copy
  const skillsToCopy: string[] = [];

  if (skillsConfig.all) {
    // Copy all available skills
    Object.values(SKILLS_MAP).forEach(skills => skillsToCopy.push(...skills));
  } else {
    if (skillsConfig.core) skillsToCopy.push(...SKILLS_MAP.core);
    if (skillsConfig.agentdb) skillsToCopy.push(...SKILLS_MAP.agentdb);
    if (skillsConfig.github) skillsToCopy.push(...SKILLS_MAP.github);
    if (skillsConfig.flowNexus) skillsToCopy.push(...SKILLS_MAP.flowNexus);
    if (skillsConfig.browser) skillsToCopy.push(...SKILLS_MAP.browser);
    if (skillsConfig.v3) skillsToCopy.push(...SKILLS_MAP.v3);
    if (skillsConfig.dualMode) skillsToCopy.push(...SKILLS_MAP.dualMode);
  }

  // Find source skills directory
  const sourceSkillsDir = findSourceDir('skills', options.sourceBaseDir);
  if (!sourceSkillsDir) {
    result.errors.push('Could not find source skills directory');
    return;
  }

  // Copy each skill
  for (const skillName of [...new Set(skillsToCopy)]) {
    const sourcePath = path.join(sourceSkillsDir, skillName);
    const targetPath = path.join(targetSkillsDir, skillName);

    if (fs.existsSync(sourcePath)) {
      if (!fs.existsSync(targetPath) || options.force) {
        copyDirRecursive(sourcePath, targetPath);
        result.created.files.push(`.claude/skills/${skillName}`);
        result.summary.skillsCount++;
      } else {
        result.skipped.push(`.claude/skills/${skillName}`);
      }
    }
  }
}

/**
 * Copy commands from source
 */
async function copyCommands(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const commandsConfig = options.commands;
  const targetCommandsDir = path.join(targetDir, '.claude', 'commands');

  // Determine which commands to copy
  const commandsToCopy: string[] = [];

  if (commandsConfig.all) {
    Object.values(COMMANDS_MAP).forEach(cmds => commandsToCopy.push(...cmds));
  } else {
    if (commandsConfig.core) commandsToCopy.push(...COMMANDS_MAP.core);
    if (commandsConfig.analysis) commandsToCopy.push(...COMMANDS_MAP.analysis);
    if (commandsConfig.automation) commandsToCopy.push(...COMMANDS_MAP.automation);
    if (commandsConfig.github) commandsToCopy.push(...COMMANDS_MAP.github);
    if (commandsConfig.hooks) commandsToCopy.push(...COMMANDS_MAP.hooks);
    if (commandsConfig.monitoring) commandsToCopy.push(...COMMANDS_MAP.monitoring);
    if (commandsConfig.optimization) commandsToCopy.push(...COMMANDS_MAP.optimization);
    if (commandsConfig.sparc) commandsToCopy.push(...COMMANDS_MAP.sparc);
    // ADR-128 Phase 4 substrate promotions
    if (commandsConfig.agents) commandsToCopy.push(...(COMMANDS_MAP.agents || []));
    if (commandsConfig.coordination) commandsToCopy.push(...(COMMANDS_MAP.coordination || []));
    if (commandsConfig.hiveMind) commandsToCopy.push(...(COMMANDS_MAP.hiveMind || []));
    if (commandsConfig.memory) commandsToCopy.push(...(COMMANDS_MAP.memory || []));
    if (commandsConfig.swarm) commandsToCopy.push(...(COMMANDS_MAP.swarm || []));
    if (commandsConfig.workflows) commandsToCopy.push(...(COMMANDS_MAP.workflows || []));
    // ADR-128 Phase 4 opt-in categories
    if (commandsConfig.pair) commandsToCopy.push(...(COMMANDS_MAP.pair || []));
    if (commandsConfig.training) commandsToCopy.push(...(COMMANDS_MAP.training || []));
    if (commandsConfig.streamChain) commandsToCopy.push(...(COMMANDS_MAP.streamChain || []));
    if (commandsConfig.truth) commandsToCopy.push(...(COMMANDS_MAP.truth || []));
    if (commandsConfig.verify) commandsToCopy.push(...(COMMANDS_MAP.verify || []));
  }

  // Find source commands directory
  const sourceCommandsDir = findSourceDir('commands', options.sourceBaseDir);
  if (!sourceCommandsDir) {
    result.errors.push('Could not find source commands directory');
    return;
  }

  // Copy each command/directory
  for (const cmdName of [...new Set(commandsToCopy)]) {
    const sourcePath = path.join(sourceCommandsDir, cmdName);
    const targetPath = path.join(targetCommandsDir, cmdName);

    if (fs.existsSync(sourcePath)) {
      if (!fs.existsSync(targetPath) || options.force) {
        if (fs.statSync(sourcePath).isDirectory()) {
          copyDirRecursive(sourcePath, targetPath);
        } else {
          fs.copyFileSync(sourcePath, targetPath);
        }
        result.created.files.push(`.claude/commands/${cmdName}`);
        result.summary.commandsCount++;
      } else {
        result.skipped.push(`.claude/commands/${cmdName}`);
      }
    }
  }
}

/**
 * Copy agents from source
 */
async function copyAgents(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const agentsConfig = options.agents;
  const targetAgentsDir = path.join(targetDir, '.claude', 'agents');

  // Determine which agents to copy
  const agentsToCopy: string[] = [];

  if (agentsConfig.all) {
    Object.values(AGENTS_MAP).forEach(agents => agentsToCopy.push(...agents));
  } else {
    if (agentsConfig.core) agentsToCopy.push(...AGENTS_MAP.core);
    if (agentsConfig.consensus) agentsToCopy.push(...AGENTS_MAP.consensus);
    if (agentsConfig.github) agentsToCopy.push(...AGENTS_MAP.github);
    if (agentsConfig.hiveMind) agentsToCopy.push(...AGENTS_MAP.hiveMind);
    if (agentsConfig.sparc) agentsToCopy.push(...AGENTS_MAP.sparc);
    if (agentsConfig.swarm) agentsToCopy.push(...AGENTS_MAP.swarm);
    if (agentsConfig.browser) agentsToCopy.push(...AGENTS_MAP.browser);
    // V3-specific agent categories
    if (agentsConfig.v3) agentsToCopy.push(...(AGENTS_MAP.v3 || []));
    if (agentsConfig.optimization) agentsToCopy.push(...(AGENTS_MAP.optimization || []));
    if (agentsConfig.testing) agentsToCopy.push(...(AGENTS_MAP.testing || []));
    // Dual-mode agents (Claude Code + Codex hybrid)
    if (agentsConfig.dualMode) agentsToCopy.push(...(AGENTS_MAP.dualMode || []));
  }

  // Find source agents directory
  const sourceAgentsDir = findSourceDir('agents', options.sourceBaseDir);
  if (!sourceAgentsDir) {
    result.errors.push('Could not find source agents directory');
    return;
  }

  // Copy each agent category
  for (const agentCategory of [...new Set(agentsToCopy)]) {
    const sourcePath = path.join(sourceAgentsDir, agentCategory);
    const targetPath = path.join(targetAgentsDir, agentCategory);

    if (fs.existsSync(sourcePath)) {
      if (!fs.existsSync(targetPath) || options.force) {
        copyDirRecursive(sourcePath, targetPath);
        // Count agent files (.md only — .yaml agents were migrated to .md)
        const mdFiles = countFiles(sourcePath, '.md');
        result.summary.agentsCount += mdFiles;
        result.created.files.push(`.claude/agents/${agentCategory}`);
      } else {
        result.skipped.push(`.claude/agents/${agentCategory}`);
      }
    }
  }
}

/**
 * Find source helpers directory.
 * Validates that the directory contains hook-handler.cjs to avoid
 * returning the target directory or an incomplete source.
 */
function findSourceHelpersDir(sourceBaseDir?: string): string | null {
  const possiblePaths: string[] = [];
  const SENTINEL_FILE = 'hook-handler.cjs'; // Must exist in valid source

  // If explicit source base directory is provided, check it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude', 'helpers'));
  }

  // Strategy 1: require.resolve to find package root (most reliable for npx)
  try {
    const esmRequire = createRequire(import.meta.url);
    const pkgJsonPath = esmRequire.resolve('@claude-flow/cli/package.json');
    const pkgRoot = path.dirname(pkgJsonPath);
    possiblePaths.push(path.join(pkgRoot, '.claude', 'helpers'));
  } catch {
    // Not installed as a package — skip
  }

  // Strategy 2: __dirname-based (dist/src/init -> package root)
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageHelpers = path.join(packageRoot, '.claude', 'helpers');
  possiblePaths.push(packageHelpers);

  // Strategy 3: Walk up from __dirname looking for package root
  let currentDir = __dirname;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // hit filesystem root
    const helpersPath = path.join(parentDir, '.claude', 'helpers');
    possiblePaths.push(helpersPath);
    currentDir = parentDir;
  }

  // Strategy 4: Check cwd-relative paths (for local dev)
  const cwdBased = [
    path.join(process.cwd(), '.claude', 'helpers'),
    path.join(process.cwd(), '..', '.claude', 'helpers'),
    path.join(process.cwd(), '..', '..', '.claude', 'helpers'),
  ];
  possiblePaths.push(...cwdBased);

  // Return first path that exists AND contains the sentinel file
  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, SENTINEL_FILE))) {
      return p;
    }
  }

  return null;
}

/**
 * Write helper scripts
 */
async function writeHelpers(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const helpersDir = path.join(targetDir, '.claude', 'helpers');

  // Find source helpers directory (works for npm package and local dev)
  const sourceHelpersDir = findSourceHelpersDir(options.sourceBaseDir);

  // On Windows: emit a notice before writing helpers — the settings.json
  // hooks will use node-based commands instead of bash shims (#2132).
  if (process.platform === 'win32') {
    console.log('Detected Windows — adding cross-platform hook overrides to .claude/settings.json (#2132)');
  }

  // Try to copy existing helpers from source first
  if (sourceHelpersDir && fs.existsSync(sourceHelpersDir)) {
    const helperFiles = fs.readdirSync(sourceHelpersDir);
    let copiedCount = 0;

    for (const file of helperFiles) {
      const sourcePath = path.join(sourceHelpersDir, file);
      const destPath = path.join(helpersDir, file);

      // Skip directories and only copy files
      if (!fs.statSync(sourcePath).isFile()) continue;

      if (!fs.existsSync(destPath) || options.force) {
        fs.copyFileSync(sourcePath, destPath);

        // Make shell scripts and mjs files executable
        if (file.endsWith('.sh') || file.endsWith('.mjs')) {
          fs.chmodSync(destPath, '755');
        }

        result.created.files.push(`.claude/helpers/${file}`);
        copiedCount++;
      } else {
        result.skipped.push(`.claude/helpers/${file}`);
      }
    }

    // #2132: Always generate ruflo-hook.cjs regardless of source copy path.
    // The source helpers dir may not contain this file (it lives in
    // plugins/ruflo-core/scripts/, not .claude/helpers/), but it must
    // always be present so Windows users can use the node-based shim.
    const rufloHookDest = path.join(helpersDir, 'ruflo-hook.cjs');
    if (!fs.existsSync(rufloHookDest) || options.force) {
      fs.writeFileSync(rufloHookDest, generateRufloHookCjs(), 'utf-8');
      result.created.files.push('.claude/helpers/ruflo-hook.cjs');
    } else {
      result.skipped.push('.claude/helpers/ruflo-hook.cjs');
    }

    if (copiedCount > 0) {
      return; // Skip generating if we copied from source
    }
  }

  // Fall back to generating helpers if source not available
  const helpers: Record<string, string> = {
    'pre-commit': generatePreCommitHook(),
    'post-commit': generatePostCommitHook(),
    'session.js': generateSessionManager(),
    'router.js': generateAgentRouter(),
    'memory.js': generateMemoryHelper(),
    'hook-handler.cjs': generateHookHandler(),
    'intelligence.cjs': generateIntelligenceStub(),
    'auto-memory-hook.mjs': generateAutoMemoryHook(),
    // #2132: cross-platform Node.js port of ruflo-hook.sh — always deployed so
    // Windows users have a working shim even if the plugin's hooks.json bash
    // commands are overridden via settings.json.
    'ruflo-hook.cjs': generateRufloHookCjs(),
  };

  for (const [name, content] of Object.entries(helpers)) {
    const filePath = path.join(helpersDir, name);

    if (!fs.existsSync(filePath) || options.force) {
      fs.writeFileSync(filePath, content, 'utf-8');

      // Make shell scripts executable
      if (!name.endsWith('.js')) {
        fs.chmodSync(filePath, '755');
      }

      result.created.files.push(`.claude/helpers/${name}`);
    } else {
      result.skipped.push(`.claude/helpers/${name}`);
    }
  }
}

/**
 * Find source .claude directory for statusline files
 */
function findSourceClaudeDir(sourceBaseDir?: string): string | null {
  const possiblePaths: string[] = [];

  // If explicit source base directory is provided, check it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude'));
  }

  // IMPORTANT: Check the package's own .claude directory
  // Go up 3 levels: dist/src/init -> dist/src -> dist -> root
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageClaude = path.join(packageRoot, '.claude');
  if (fs.existsSync(packageClaude)) {
    possiblePaths.unshift(packageClaude); // Add to beginning (highest priority)
  }

  // From dist/src/init -> go up to project root
  let currentDir = __dirname;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    const claudePath = path.join(parentDir, '.claude');
    if (fs.existsSync(claudePath)) {
      possiblePaths.push(claudePath);
    }
    currentDir = parentDir;
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Write statusline configuration
 */
async function writeStatusline(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const claudeDir = path.join(targetDir, '.claude');
  const helpersDir = path.join(targetDir, '.claude', 'helpers');

  // Find source .claude directory (works for npm package and local dev)
  const sourceClaudeDir = findSourceClaudeDir(options.sourceBaseDir);

  // Try to copy existing advanced statusline files from source
  const advancedStatuslineFiles = [
    { src: 'statusline.sh', dest: 'statusline.sh', dir: claudeDir },
    { src: 'statusline.mjs', dest: 'statusline.mjs', dir: claudeDir },
  ];

  if (sourceClaudeDir) {
    for (const file of advancedStatuslineFiles) {
      const sourcePath = path.join(sourceClaudeDir, file.src);
      const destPath = path.join(file.dir, file.dest);

      if (fs.existsSync(sourcePath)) {
        if (!fs.existsSync(destPath) || options.force) {
          fs.copyFileSync(sourcePath, destPath);
          // Make shell scripts and mjs executable
          if (file.src.endsWith('.sh') || file.src.endsWith('.mjs')) {
            fs.chmodSync(destPath, '755');
          }
          result.created.files.push(`.claude/${file.dest}`);
        } else {
          result.skipped.push(`.claude/${file.dest}`);
        }
      }
    }
  }

  // ALWAYS generate statusline.cjs — the generated version includes AgentDB
  // vectors/size, tests, ADRs, hooks, and integration stats that the
  // pre-installed static copy in the npm package lacks.
  // This must overwrite any copy from writeHelpers() which copies the legacy file.
  const statuslineScript = generateStatuslineScript(options);
  const statuslinePath = path.join(helpersDir, 'statusline.cjs');

  fs.writeFileSync(statuslinePath, statuslineScript, 'utf-8');
  result.created.files.push('.claude/helpers/statusline.cjs');
}

/**
 * Write runtime configuration (.claude-flow/)
 */
async function writeRuntimeConfig(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const configPath = path.join(targetDir, '.claude-flow', 'config.yaml');

  if (fs.existsSync(configPath) && !options.force) {
    result.skipped.push('.claude-flow/config.yaml');
    return;
  }

  const config = `# RuFlo V3 Runtime Configuration
# Generated: ${new Date().toISOString()}

version: "3.0.0"

swarm:
  topology: ${options.runtime.topology}
  maxAgents: ${options.runtime.maxAgents}
  autoScale: true
  coordinationStrategy: consensus

memory:
  backend: ${options.runtime.memoryBackend}
  enableHNSW: ${options.runtime.enableHNSW}
  persistPath: .claude-flow/data
  cacheSize: 100
  # ADR-049: Self-Learning Memory
  learningBridge:
    enabled: ${options.runtime.enableLearningBridge ?? options.runtime.enableNeural}
    sonaMode: balanced
    confidenceDecayRate: 0.005
    accessBoostAmount: 0.03
    consolidationThreshold: 10
  memoryGraph:
    enabled: ${options.runtime.enableMemoryGraph ?? true}
    pageRankDamping: 0.85
    maxNodes: 5000
    similarityThreshold: 0.8
  agentScopes:
    enabled: ${options.runtime.enableAgentScopes ?? true}
    defaultScope: project

neural:
  enabled: ${options.runtime.enableNeural}
  modelPath: .claude-flow/neural

hooks:
  enabled: true
  autoExecute: true

mcp:
  autoStart: ${options.mcp.autoStart}
  port: ${options.mcp.port}
`;

  fs.writeFileSync(configPath, config, 'utf-8');
  result.created.files.push('.claude-flow/config.yaml');

  // Write .gitignore
  const gitignorePath = path.join(targetDir, '.claude-flow', '.gitignore');
  const gitignore = `# Claude Flow runtime files
data/
logs/
sessions/
neural/
*.log
*.tmp
`;

  if (!fs.existsSync(gitignorePath) || options.force) {
    fs.writeFileSync(gitignorePath, gitignore, 'utf-8');
    result.created.files.push('.claude-flow/.gitignore');
  }

  // Write CAPABILITIES.md with full system overview
  await writeCapabilitiesDoc(targetDir, options, result);
}

/**
 * Write initial metrics files for statusline
 * Creates baseline data so statusline shows meaningful state instead of all zeros
 */
async function writeInitialMetrics(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const metricsDir = path.join(targetDir, '.claude-flow', 'metrics');
  const learningDir = path.join(targetDir, '.claude-flow', 'learning');
  const securityDir = path.join(targetDir, '.claude-flow', 'security');

  // Ensure directories exist
  for (const dir of [metricsDir, learningDir, securityDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Create initial v3-progress.json
  const progressPath = path.join(metricsDir, 'v3-progress.json');
  if (!fs.existsSync(progressPath) || options.force) {
    const progress = {
      version: '3.0.0',
      initialized: new Date().toISOString(),
      domains: {
        completed: 0,
        total: 5,
        status: 'INITIALIZING'
      },
      ddd: {
        progress: 0,
        modules: 0,
        totalFiles: 0,
        totalLines: 0
      },
      swarm: {
        activeAgents: 0,
        maxAgents: options.runtime.maxAgents,
        topology: options.runtime.topology
      },
      learning: {
        status: 'READY',
        patternsLearned: 0,
        sessionsCompleted: 0
      },
      _note: 'Metrics will update as you use Ruflo. Run: npx ruflo@latest daemon start'
    };
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
    result.created.files.push('.claude-flow/metrics/v3-progress.json');
  }

  // Create initial swarm-activity.json
  const activityPath = path.join(metricsDir, 'swarm-activity.json');
  if (!fs.existsSync(activityPath) || options.force) {
    const activity = {
      timestamp: new Date().toISOString(),
      processes: {
        agentic_flow: 0,
        mcp_server: 0,
        estimated_agents: 0
      },
      swarm: {
        active: false,
        agent_count: 0,
        coordination_active: false
      },
      integration: {
        agentic_flow_active: false,
        mcp_active: false
      },
      _initialized: true
    };
    fs.writeFileSync(activityPath, JSON.stringify(activity, null, 2), 'utf-8');
    result.created.files.push('.claude-flow/metrics/swarm-activity.json');
  }

  // Create initial learning.json
  const learningPath = path.join(metricsDir, 'learning.json');
  if (!fs.existsSync(learningPath) || options.force) {
    const learning = {
      initialized: new Date().toISOString(),
      routing: {
        accuracy: 0,
        decisions: 0
      },
      patterns: {
        shortTerm: 0,
        longTerm: 0,
        quality: 0
      },
      sessions: {
        total: 0,
        current: null
      },
      _note: 'Intelligence grows as you use Ruflo'
    };
    fs.writeFileSync(learningPath, JSON.stringify(learning, null, 2), 'utf-8');
    result.created.files.push('.claude-flow/metrics/learning.json');
  }

  // Create initial audit-status.json
  const auditPath = path.join(securityDir, 'audit-status.json');
  if (!fs.existsSync(auditPath) || options.force) {
    const audit = {
      initialized: new Date().toISOString(),
      status: 'PENDING',
      cvesFixed: 0,
      totalCves: 0,
      lastScan: null,
      _note: 'Run: npx @claude-flow/cli@latest security scan'
    };
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf-8');
    result.created.files.push('.claude-flow/security/audit-status.json');
  }
}

/**
 * Write CAPABILITIES.md - comprehensive overview of all Ruflo features
 */
async function writeCapabilitiesDoc(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const capabilitiesPath = path.join(targetDir, '.claude-flow', 'CAPABILITIES.md');

  if (fs.existsSync(capabilitiesPath) && !options.force) {
    result.skipped.push('.claude-flow/CAPABILITIES.md');
    return;
  }

  const capabilities = `# RuFlo V3 - Complete Capabilities Reference
> Generated: ${new Date().toISOString()}
> Full documentation: https://github.com/ruvnet/claude-flow

## 📋 Table of Contents

1. [Overview](#overview)
2. [Swarm Orchestration](#swarm-orchestration)
3. [Available Agents (60+)](#available-agents)
4. [CLI Commands (26 Commands, 140+ Subcommands)](#cli-commands)
5. [Hooks System (27 Hooks + 12 Workers)](#hooks-system)
6. [Memory & Intelligence (RuVector)](#memory--intelligence)
7. [Hive-Mind Consensus](#hive-mind-consensus)
8. [Performance Targets](#performance-targets)
9. [Integration Ecosystem](#integration-ecosystem)

---

## Overview

RuFlo V3 is a domain-driven design architecture for multi-agent AI coordination with:

- **15-Agent Swarm Coordination** with hierarchical and mesh topologies
- **HNSW Vector Search** - 150x-12,500x faster pattern retrieval
- **SONA Neural Learning** - Self-optimizing with <0.05ms adaptation
- **Byzantine Fault Tolerance** - Queen-led consensus mechanisms
- **MCP Server Integration** - Model Context Protocol support

### Current Configuration
| Setting | Value |
|---------|-------|
| Topology | ${options.runtime.topology} |
| Max Agents | ${options.runtime.maxAgents} |
| Memory Backend | ${options.runtime.memoryBackend} |
| HNSW Indexing | ${options.runtime.enableHNSW ? 'Enabled' : 'Disabled'} |
| Neural Learning | ${options.runtime.enableNeural ? 'Enabled' : 'Disabled'} |
| LearningBridge | ${options.runtime.enableLearningBridge ? 'Enabled (SONA + ReasoningBank)' : 'Disabled'} |
| Knowledge Graph | ${options.runtime.enableMemoryGraph ? 'Enabled (PageRank + Communities)' : 'Disabled'} |
| Agent Scopes | ${options.runtime.enableAgentScopes ? 'Enabled (project/local/user)' : 'Disabled'} |

---

## Swarm Orchestration

### Topologies
| Topology | Description | Best For |
|----------|-------------|----------|
| \`hierarchical\` | Queen controls workers directly | Anti-drift, tight control |
| \`mesh\` | Fully connected peer network | Distributed tasks |
| \`hierarchical-mesh\` | V3 hybrid (recommended) | 10+ agents |
| \`ring\` | Circular communication | Sequential workflows |
| \`star\` | Central coordinator | Simple coordination |
| \`adaptive\` | Dynamic based on load | Variable workloads |

### Strategies
- \`balanced\` - Even distribution across agents
- \`specialized\` - Clear roles, no overlap (anti-drift)
- \`adaptive\` - Dynamic task routing

### Quick Commands
\`\`\`bash
# Initialize swarm
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized

# Check status
npx @claude-flow/cli@latest swarm status

# Monitor activity
npx @claude-flow/cli@latest swarm monitor
\`\`\`

---

## Available Agents

### Core Development (5)
\`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`

### V3 Specialized (4)
\`security-architect\`, \`security-auditor\`, \`memory-specialist\`, \`performance-engineer\`

### Swarm Coordination (5)
\`hierarchical-coordinator\`, \`mesh-coordinator\`, \`adaptive-coordinator\`, \`collective-intelligence-coordinator\`, \`swarm-memory-manager\`

### Consensus & Distributed (7)
\`byzantine-coordinator\`, \`raft-manager\`, \`gossip-coordinator\`, \`consensus-builder\`, \`crdt-synchronizer\`, \`quorum-manager\`, \`security-manager\`

### Performance & Optimization (5)
\`perf-analyzer\`, \`performance-benchmarker\`, \`task-orchestrator\`, \`memory-coordinator\`, \`smart-agent\`

### GitHub & Repository (9)
\`github-modes\`, \`pr-manager\`, \`code-review-swarm\`, \`issue-tracker\`, \`release-manager\`, \`workflow-automation\`, \`project-board-sync\`, \`repo-architect\`, \`multi-repo-swarm\`

### SPARC Methodology (6)
\`sparc-coord\`, \`sparc-coder\`, \`specification\`, \`pseudocode\`, \`architecture\`, \`refinement\`

### Specialized Development (8)
\`backend-dev\`, \`mobile-dev\`, \`ml-developer\`, \`cicd-engineer\`, \`api-docs\`, \`system-architect\`, \`code-analyzer\`, \`base-template-generator\`

### Testing & Validation (2)
\`tdd-london-swarm\`, \`production-validator\`

### Agent Routing by Task
| Task Type | Recommended Agents | Topology |
|-----------|-------------------|----------|
| Bug Fix | researcher, coder, tester | mesh |
| New Feature | coordinator, architect, coder, tester, reviewer | hierarchical |
| Refactoring | architect, coder, reviewer | mesh |
| Performance | researcher, perf-engineer, coder | hierarchical |
| Security | security-architect, auditor, reviewer | hierarchical |
| Docs | researcher, api-docs | mesh |

---

## CLI Commands

### Core Commands (12)
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`init\` | 4 | Project initialization |
| \`agent\` | 8 | Agent lifecycle management |
| \`swarm\` | 6 | Multi-agent coordination |
| \`memory\` | 11 | AgentDB with HNSW search |
| \`mcp\` | 9 | MCP server management |
| \`task\` | 6 | Task assignment |
| \`session\` | 7 | Session persistence |
| \`config\` | 7 | Configuration |
| \`status\` | 3 | System monitoring |
| \`workflow\` | 6 | Workflow templates |
| \`hooks\` | 17 | Self-learning hooks |
| \`hive-mind\` | 6 | Consensus coordination |

### Advanced Commands (14)
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`daemon\` | 5 | Background workers |
| \`neural\` | 5 | Pattern training |
| \`security\` | 6 | Security scanning |
| \`performance\` | 5 | Profiling & benchmarks |
| \`providers\` | 5 | AI provider config |
| \`plugins\` | 5 | Plugin management |
| \`deployment\` | 5 | Deploy management |
| \`embeddings\` | 4 | Vector embeddings |
| \`claims\` | 4 | Authorization |
| \`migrate\` | 5 | V2→V3 migration |
| \`process\` | 4 | Process management |
| \`doctor\` | 1 | Health diagnostics |
| \`completions\` | 4 | Shell completions |

### Example Commands
\`\`\`bash
# Initialize
npx @claude-flow/cli@latest init --wizard

# Spawn agent
npx @claude-flow/cli@latest agent spawn -t coder --name my-coder

# Memory operations
npx @claude-flow/cli@latest memory store --key "pattern" --value "data" --namespace patterns
npx @claude-flow/cli@latest memory search --query "authentication"

# Diagnostics
npx @claude-flow/cli@latest doctor --fix
\`\`\`

---

## Hooks System

### 27 Available Hooks

#### Core Hooks (6)
| Hook | Description |
|------|-------------|
| \`pre-edit\` | Context before file edits |
| \`post-edit\` | Record edit outcomes |
| \`pre-command\` | Risk assessment |
| \`post-command\` | Command metrics |
| \`pre-task\` | Task start + agent suggestions |
| \`post-task\` | Task completion learning |

#### Session Hooks (4)
| Hook | Description |
|------|-------------|
| \`session-start\` | Start/restore session |
| \`session-end\` | Persist state |
| \`session-restore\` | Restore previous |
| \`notify\` | Cross-agent notifications |

#### Intelligence Hooks (5)
| Hook | Description |
|------|-------------|
| \`route\` | Optimal agent routing |
| \`explain\` | Routing decisions |
| \`pretrain\` | Bootstrap intelligence |
| \`build-agents\` | Generate configs |
| \`transfer\` | Pattern transfer |

#### Coverage Hooks (3)
| Hook | Description |
|------|-------------|
| \`coverage-route\` | Coverage-based routing |
| \`coverage-suggest\` | Improvement suggestions |
| \`coverage-gaps\` | Gap analysis |

### 12 Background Workers
| Worker | Priority | Purpose |
|--------|----------|---------|
| \`ultralearn\` | normal | Deep knowledge |
| \`optimize\` | high | Performance |
| \`consolidate\` | low | Memory consolidation |
| \`predict\` | normal | Predictive preload |
| \`audit\` | critical | Security |
| \`map\` | normal | Codebase mapping |
| \`preload\` | low | Resource preload |
| \`deepdive\` | normal | Deep analysis |
| \`document\` | normal | Auto-docs |
| \`refactor\` | normal | Suggestions |
| \`benchmark\` | normal | Benchmarking |
| \`testgaps\` | normal | Coverage gaps |

---

## Memory & Intelligence

### RuVector Intelligence System
- **SONA**: Self-Optimizing Neural Architecture (<0.05ms)
- **MoE**: Mixture of Experts routing
- **HNSW**: 150x-12,500x faster search
- **EWC++**: Prevents catastrophic forgetting
- **Flash Attention**: 2.49x-7.47x speedup
- **Int8 Quantization**: 3.92x memory reduction

### 4-Step Intelligence Pipeline
1. **RETRIEVE** - HNSW pattern search
2. **JUDGE** - Success/failure verdicts
3. **DISTILL** - LoRA learning extraction
4. **CONSOLIDATE** - EWC++ preservation

### Self-Learning Memory (ADR-049)

| Component | Status | Description |
|-----------|--------|-------------|
| **LearningBridge** | ${options.runtime.enableLearningBridge ? '✅ Enabled' : '⏸ Disabled'} | Connects insights to SONA/ReasoningBank neural pipeline |
| **MemoryGraph** | ${options.runtime.enableMemoryGraph ? '✅ Enabled' : '⏸ Disabled'} | PageRank knowledge graph + community detection |
| **AgentMemoryScope** | ${options.runtime.enableAgentScopes ? '✅ Enabled' : '⏸ Disabled'} | 3-scope agent memory (project/local/user) |

**LearningBridge** - Insights trigger learning trajectories. Confidence evolves: +0.03 on access, -0.005/hour decay. Consolidation runs the JUDGE/DISTILL/CONSOLIDATE pipeline.

**MemoryGraph** - Builds a knowledge graph from entry references. PageRank identifies influential insights. Communities group related knowledge. Graph-aware ranking blends vector + structural scores.

**AgentMemoryScope** - Maps Claude Code 3-scope directories:
- \`project\`: \`<gitRoot>/.claude/agent-memory/<agent>/\`
- \`local\`: \`<gitRoot>/.claude/agent-memory-local/<agent>/\`
- \`user\`: \`~/.claude/agent-memory/<agent>/\`

High-confidence insights (>0.8) can transfer between agents.

### Memory Commands
\`\`\`bash
# Store pattern
npx @claude-flow/cli@latest memory store --key "name" --value "data" --namespace patterns

# Semantic search
npx @claude-flow/cli@latest memory search --query "authentication"

# List entries
npx @claude-flow/cli@latest memory list --namespace patterns

# Initialize database
npx @claude-flow/cli@latest memory init --force
\`\`\`

---

## Hive-Mind Consensus

### Queen Types
| Type | Role |
|------|------|
| Strategic Queen | Long-term planning |
| Tactical Queen | Execution coordination |
| Adaptive Queen | Dynamic optimization |

### Worker Types (8)
\`researcher\`, \`coder\`, \`analyst\`, \`tester\`, \`architect\`, \`reviewer\`, \`optimizer\`, \`documenter\`

### Consensus Mechanisms
| Mechanism | Fault Tolerance | Use Case |
|-----------|-----------------|----------|
| \`byzantine\` | f < n/3 faulty | Adversarial |
| \`raft\` | f < n/2 failed | Leader-based |
| \`gossip\` | Eventually consistent | Large scale |
| \`crdt\` | Conflict-free | Distributed |
| \`quorum\` | Configurable | Flexible |

### Hive-Mind Commands
\`\`\`bash
# Initialize
npx @claude-flow/cli@latest hive-mind init --queen-type strategic

# Status
npx @claude-flow/cli@latest hive-mind status

# Spawn workers
npx @claude-flow/cli@latest hive-mind spawn --count 5 --type worker

# Consensus
npx @claude-flow/cli@latest hive-mind consensus --propose "task"
\`\`\`

---

## Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| HNSW Search | 150x-12,500x faster | ✅ Implemented |
| Memory Reduction | 50-75% | ✅ Implemented (3.92x) |
| SONA Integration | Pattern learning | ✅ Implemented |
| Flash Attention | 2.49x-7.47x | 🔄 In Progress |
| MCP Response | <100ms | ✅ Achieved |
| CLI Startup | <500ms | ✅ Achieved |
| SONA Adaptation | <0.05ms | 🔄 In Progress |
| Graph Build (1k) | <200ms | ✅ 2.78ms (71.9x headroom) |
| PageRank (1k) | <100ms | ✅ 12.21ms (8.2x headroom) |
| Insight Recording | <5ms/each | ✅ 0.12ms (41x headroom) |
| Consolidation | <500ms | ✅ 0.26ms (1,955x headroom) |
| Knowledge Transfer | <100ms | ✅ 1.25ms (80x headroom) |

---

## Integration Ecosystem

### Integrated Packages
| Package | Version | Purpose |
|---------|---------|---------|
| agentic-flow | 3.0.0-alpha.1 | Core coordination + ReasoningBank + Router |
| agentdb | 3.0.0-alpha.10 | Vector database + 8 controllers |
| @ruvector/attention | 0.1.3 | Flash attention |
| @ruvector/sona | 0.1.5 | Neural learning |

### Optional Integrations
| Package | Command |
|---------|---------|
| ruv-swarm | \`npx ruv-swarm mcp start\` |
| flow-nexus | \`npx flow-nexus@latest mcp start\` |
| agentic-jujutsu | \`npx agentic-jujutsu@latest\` |

### MCP Server Setup
\`\`\`bash
# Add Ruflo MCP
claude mcp add ruflo -- npx -y ruflo@latest mcp start

# Optional servers
claude mcp add ruv-swarm -- npx -y ruv-swarm mcp start
claude mcp add flow-nexus -- npx -y flow-nexus@latest mcp start
\`\`\`

---

## Quick Reference

### Essential Commands
\`\`\`bash
# Setup
npx ruflo@latest init --wizard
npx ruflo@latest daemon start
npx ruflo@latest doctor --fix

# Swarm
npx ruflo@latest swarm init --topology hierarchical --max-agents 8
npx ruflo@latest swarm status

# Agents
npx ruflo@latest agent spawn -t coder
npx ruflo@latest agent list

# Memory
npx ruflo@latest memory search --query "patterns"

# Hooks
npx ruflo@latest hooks pre-task --description "task"
npx ruflo@latest hooks worker dispatch --trigger optimize
\`\`\`

### File Structure
\`\`\`
.claude-flow/
├── config.yaml      # Runtime configuration
├── CAPABILITIES.md  # This file
├── data/            # Memory storage
├── logs/            # Operation logs
├── sessions/        # Session state
├── hooks/           # Custom hooks
├── agents/          # Agent configs
└── workflows/       # Workflow templates
\`\`\`

---

**Full Documentation**: https://github.com/ruvnet/claude-flow
**Issues**: https://github.com/ruvnet/claude-flow/issues
`;

  fs.writeFileSync(capabilitiesPath, capabilities, 'utf-8');
  result.created.files.push('.claude-flow/CAPABILITIES.md');
}

/**
 * Write CLAUDE.md with swarm guidance
 */
async function writeClaudeMd(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');

  if (fs.existsSync(claudeMdPath) && !options.force) {
    result.skipped.push('CLAUDE.md');
  } else {
    // #2208: if overwriting an existing CLAUDE.md (force mode), back it up first so
    // users don't silently lose curated project context.
    if (fs.existsSync(claudeMdPath)) {
      const backupBase = `${claudeMdPath}.pre-ruflo`;
      // Don't clobber an existing backup — append a timestamp if one already exists.
      const backupPath = fs.existsSync(backupBase)
        ? `${backupBase}.${Date.now()}`
        : backupBase;
      fs.copyFileSync(claudeMdPath, backupPath);
      result.created.files.push(path.basename(backupPath));
      console.warn(`[ruflo init] Existing CLAUDE.md backed up to ${path.basename(backupPath)} before overwrite`);
    }
    // Determine template: explicit option > infer from components > 'standard'
    const inferredTemplate = (!options.components.commands && !options.components.agents) ? 'minimal' : undefined;
    const content = generateClaudeMd(options, inferredTemplate);

    fs.writeFileSync(claudeMdPath, content, 'utf-8');
    result.created.files.push('CLAUDE.md');
  }

  // Also write/append global ~/.claude/CLAUDE.md so ruflo tools are used automatically (#1497).
  // Opt-out via --no-global / options.skipGlobalClaudeMd (#1744 — keeps global rules file pristine
  // for users who don't want a per-machine pointer block).
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (homeDir && !options.skipGlobalClaudeMd) {
    const globalClaudeDir = path.join(homeDir, '.claude');
    const globalClaudeMd = path.join(globalClaudeDir, 'CLAUDE.md');
    const rufloBlock = [
      '',
      '# Ruflo Integration (auto-generated by ruflo init)',
      'When working on multi-file tasks or complex features, use ToolSearch to find and invoke ruflo MCP tools.',
      'Key tools: memory_store, memory_search, hooks_route, swarm_init, agent_spawn.',
      'Check system-reminder tags for [INTELLIGENCE] pattern suggestions before starting work.',
      '',
    ].join('\n');

    try {
      if (!fs.existsSync(globalClaudeDir)) {
        fs.mkdirSync(globalClaudeDir, { recursive: true });
      }
      if (fs.existsSync(globalClaudeMd)) {
        const existing = fs.readFileSync(globalClaudeMd, 'utf-8');
        if (!existing.includes('Ruflo Integration')) {
          fs.appendFileSync(globalClaudeMd, rufloBlock);
          result.created.files.push('~/.claude/CLAUDE.md (appended ruflo block)');
        }
      } else {
        fs.writeFileSync(globalClaudeMd, rufloBlock.trimStart(), 'utf-8');
        result.created.files.push('~/.claude/CLAUDE.md');
      }
    } catch {
      // Non-critical — global CLAUDE.md is best-effort
    }
  } else if (options.skipGlobalClaudeMd) {
    result.skipped.push('~/.claude/CLAUDE.md (--no-global)');
  }
}

/**
 * Find source directory for skills/commands/agents
 */
function findSourceDir(type: 'skills' | 'commands' | 'agents', sourceBaseDir?: string): string | null {
  // Build list of possible paths to check
  const possiblePaths: string[] = [];

  // If explicit source base directory is provided, use it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude', type));
  }

  // IMPORTANT: Check the package's own .claude directory first
  // This is the primary path when running as an npm package
  // __dirname is typically /path/to/node_modules/@claude-flow/cli/dist/src/init
  // We need to go up 3 levels to reach the package root (dist/src/init -> dist/src -> dist -> root)
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageDotClaude = path.join(packageRoot, '.claude', type);
  if (fs.existsSync(packageDotClaude)) {
    possiblePaths.unshift(packageDotClaude); // Add to beginning (highest priority)
  }

  // From dist/src/init -> go up to project root
  const distPath = __dirname;

  // Try to find the project root by looking for .claude directory
  let currentDir = distPath;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    const dotClaudePath = path.join(parentDir, '.claude', type);
    if (fs.existsSync(dotClaudePath)) {
      possiblePaths.push(dotClaudePath);
    }
    currentDir = parentDir;
  }

  // Also check relative to process.cwd() for development
  const cwdBased = [
    path.join(process.cwd(), '.claude', type),
    path.join(process.cwd(), '..', '.claude', type),
    path.join(process.cwd(), '..', '..', '.claude', type),
  ];
  possiblePaths.push(...cwdBased);

  // Check v2 directory for agents
  if (type === 'agents') {
    possiblePaths.push(
      path.join(process.cwd(), 'v2', '.claude', type),
      path.join(process.cwd(), '..', 'v2', '.claude', type),
    );
  }

  // Plugin directory
  possiblePaths.push(
    path.join(process.cwd(), 'plugin', type),
    path.join(process.cwd(), '..', 'plugin', type),
  );

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Copy directory recursively
 */
function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Count files with extension in directory
 */
function countFiles(dir: string, ext: string): number {
  let count = 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      count += countFiles(fullPath, ext);
    } else if (entry.name.endsWith(ext)) {
      count++;
    }
  }

  return count;
}

/**
 * Count enabled hooks
 */
function countEnabledHooks(options: InitOptions): number {
  const hooks = options.hooks;
  let count = 0;

  if (hooks.preToolUse) count++;
  if (hooks.postToolUse) count++;
  if (hooks.userPromptSubmit) count++;
  if (hooks.sessionStart) count++;
  if (hooks.stop) count++;
  if (hooks.preCompact) count++;
  if (hooks.notification) count++;

  return count;
}

export default executeInit;
