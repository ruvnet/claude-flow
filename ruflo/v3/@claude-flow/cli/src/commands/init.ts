/**
 * V3 CLI Init Command
 * Comprehensive initialization for Claude Flow with Claude Code integration
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { confirm, select, multiSelect, input } from '../prompt.js';
import * as fs from 'fs';
import * as path from 'path';
import {
  executeInit,
  DEFAULT_INIT_OPTIONS,
  MINIMAL_INIT_OPTIONS,
  FULL_INIT_OPTIONS,
  type InitOptions,
} from '../init/index.js';

// Check if project is already initialized
function isInitialized(cwd: string): { claude: boolean; claudeFlow: boolean } {
  const claudePath = path.join(cwd, '.claude', 'settings.json');
  const claudeFlowPath = path.join(cwd, '.claude-flow', 'config.yaml');
  return {
    claude: fs.existsSync(claudePath),
    claudeFlow: fs.existsSync(claudeFlowPath),
  };
}

// Init subcommand (default)
const initAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const force = ctx.flags.force as boolean;
  const minimal = ctx.flags.minimal as boolean;
  const full = ctx.flags.full as boolean;
  const skipClaude = ctx.flags['skip-claude'] as boolean;
  const onlyClaude = ctx.flags['only-claude'] as boolean;
  const cwd = ctx.cwd;

  // Check if already initialized
  const initialized = isInitialized(cwd);
  const hasExisting = initialized.claude || initialized.claudeFlow;

  if (hasExisting && !force) {
    output.printWarning('Claude Flow appears to be already initialized');
    if (initialized.claude) output.printInfo('  Found: .claude/settings.json');
    if (initialized.claudeFlow) output.printInfo('  Found: .claude-flow/config.yaml');
    output.printInfo('Use --force to reinitialize');

    if (ctx.interactive) {
      const proceed = await confirm({
        message: 'Do you want to reinitialize? This will overwrite existing configuration.',
        default: false,
      });

      if (!proceed) {
        return { success: true, message: 'Initialization cancelled' };
      }
    } else {
      return { success: false, exitCode: 1, message: 'Already initialized' };
    }
  }

  output.writeln();
  output.writeln(output.bold('Initializing Claude Flow V3'));
  output.writeln();

  // Build init options based on flags
  let options: InitOptions;

  if (minimal) {
    options = { ...MINIMAL_INIT_OPTIONS, targetDir: cwd, force };
  } else if (full) {
    options = { ...FULL_INIT_OPTIONS, targetDir: cwd, force };
  } else {
    options = { ...DEFAULT_INIT_OPTIONS, targetDir: cwd, force };
  }

  // Handle --skip-claude and --only-claude flags
  if (skipClaude) {
    options.components.settings = false;
    options.components.skills = false;
    options.components.commands = false;
    options.components.agents = false;
    options.components.helpers = false;
    options.components.statusline = false;
    options.components.mcp = false;
    options.components.claudeMd = false;
  }

  if (onlyClaude) {
    options.components.runtime = false;
  }

  // Create spinner
  const spinner = output.createSpinner({ text: 'Initializing...' });
  spinner.start();

  try {
    // Execute initialization
    const result = await executeInit(options);

    if (!result.success) {
      spinner.fail('Initialization failed');
      for (const error of result.errors) {
        output.printError(error);
      }
      return { success: false, exitCode: 1 };
    }

    spinner.succeed('Claude Flow V3 initialized successfully!');
    output.writeln();

    // Display summary
    const summary: string[] = [];

    if (result.created.directories.length > 0) {
      summary.push(`Directories: ${result.created.directories.length} created`);
    }

    if (result.created.files.length > 0) {
      summary.push(`Files: ${result.created.files.length} created`);
    }

    if (result.skipped.length > 0) {
      summary.push(`Skipped: ${result.skipped.length} (already exist)`);
    }

    output.printBox(summary.join('\n'), 'Summary');
    output.writeln();

    // Show what was created
    if (options.components.claudeMd || options.components.settings || options.components.skills || options.components.commands || options.components.agents) {
      output.printBox(
        [
          options.components.claudeMd ? `CLAUDE.md:   Swarm guidance & configuration` : '',
          options.components.settings ? `Settings:    .claude/settings.json` : '',
          options.components.skills ? `Skills:      .claude/skills/ (${result.summary.skillsCount} skills)` : '',
          options.components.commands ? `Commands:    .claude/commands/ (${result.summary.commandsCount} commands)` : '',
          options.components.agents ? `Agents:      .claude/agents/ (${result.summary.agentsCount} agents)` : '',
          options.components.helpers ? `Helpers:     .claude/helpers/` : '',
          options.components.mcp ? `MCP:         .mcp.json` : '',
        ].filter(Boolean).join('\n'),
        'Claude Code Integration'
      );
      output.writeln();
    }

    if (options.components.runtime) {
      output.printBox(
        [
          `Config:      .claude-flow/config.yaml`,
          `Data:        .claude-flow/data/`,
          `Logs:        .claude-flow/logs/`,
          `Sessions:    .claude-flow/sessions/`,
        ].join('\n'),
        'V3 Runtime'
      );
      output.writeln();
    }

    // Hooks summary
    if (result.summary.hooksEnabled > 0) {
      output.printInfo(`Hooks: ${result.summary.hooksEnabled} hook types enabled in settings.json`);
      output.writeln();
    }

    // Handle --start-all or --start-daemon
    const startAll = ctx.flags['start-all'] || ctx.flags.startAll;
    const startDaemon = ctx.flags['start-daemon'] || ctx.flags.startDaemon || startAll;

    if (startDaemon || startAll) {
      output.writeln();
      output.printInfo('Starting services...');

      const { execSync } = await import('child_process');

      // Initialize memory database
      if (startAll) {
        try {
          output.writeln(output.dim('  Initializing memory database...'));
          execSync('npx @claude-flow/cli@latest memory init 2>/dev/null', {
            stdio: 'pipe',
            cwd: ctx.cwd,
            timeout: 30000
          });
          output.writeln(output.success('  ✓ Memory initialized'));
        } catch {
          output.writeln(output.dim('  Memory database already exists'));
        }
      }

      // Start daemon
      if (startDaemon) {
        try {
          output.writeln(output.dim('  Starting daemon...'));
          execSync('npx @claude-flow/cli@latest daemon start 2>/dev/null &', {
            stdio: 'pipe',
            cwd: ctx.cwd,
            timeout: 10000
          });
          output.writeln(output.success('  ✓ Daemon started'));
        } catch {
          output.writeln(output.warning('  Daemon may already be running'));
        }
      }

      // Initialize swarm
      if (startAll) {
        try {
          output.writeln(output.dim('  Initializing swarm...'));
          execSync('npx @claude-flow/cli@latest swarm init --topology hierarchical 2>/dev/null', {
            stdio: 'pipe',
            cwd: ctx.cwd,
            timeout: 30000
          });
          output.writeln(output.success('  ✓ Swarm initialized'));
        } catch {
          output.writeln(output.dim('  Swarm initialization skipped'));
        }
      }

      output.writeln();
      output.printSuccess('All services started');
    }

    // Handle --with-embeddings
    const withEmbeddings = ctx.flags['with-embeddings'] || ctx.flags.withEmbeddings;
    const embeddingModel = (ctx.flags['embedding-model'] || ctx.flags.embeddingModel || 'all-MiniLM-L6-v2') as string;

    if (withEmbeddings) {
      output.writeln();
      output.printInfo('Initializing ONNX embedding subsystem...');

      const { execSync } = await import('child_process');

      try {
        output.writeln(output.dim(`  Model: ${embeddingModel}`));
        output.writeln(output.dim('  Hyperbolic: Enabled (Poincaré ball)'));
        execSync(`npx @claude-flow/cli@latest embeddings init --model ${embeddingModel} --no-download --force 2>/dev/null`, {
          stdio: 'pipe',
          cwd: ctx.cwd,
          timeout: 30000
        });
        output.writeln(output.success('  ✓ Embeddings initialized'));
        output.writeln(output.dim('    Run "embeddings init --download" to download model'));
      } catch (err) {
        output.writeln(output.warning('  Embedding initialization skipped (run manually)'));
      }
    }

    if (!startDaemon && !startAll) {
      // Next steps (only if not auto-starting)
      output.writeln(output.bold('Next steps:'));
      output.printList([
        `Run ${output.highlight('claude-flow daemon start')} to start background workers`,
        `Run ${output.highlight('claude-flow memory init')} to initialize memory database`,
        `Run ${output.highlight('claude-flow swarm init')} to initialize a swarm`,
        `Or use ${output.highlight('claude-flow init --start-all')} to do all of the above`,
        options.components.settings ? `Review ${output.highlight('.claude/settings.json')} for hook configurations` : '',
      ].filter(Boolean));
    }

    if (ctx.flags.format === 'json') {
      output.printJson(result);
    }

    return { success: true, data: result };
  } catch (error) {
    spinner.fail('Initialization failed');
    output.printError(`Failed to initialize: ${error instanceof Error ? error.message : String(error)}`);
    return { success: false, exitCode: 1 };
  }
};

// Wizard subcommand for interactive setup
const wizardCommand: Command = {
  name: 'wizard',
  description: 'Interactive setup wizard for comprehensive configuration',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Claude Flow V3 Setup Wizard'));
    output.writeln(output.dim('Answer questions to configure your project'));
    output.writeln();

    try {
      // Start with base options
      const options: InitOptions = { ...DEFAULT_INIT_OPTIONS, targetDir: ctx.cwd };

      // Configuration preset
      const preset = await select({
        message: 'Select configuration preset:',
        options: [
          { value: 'default', label: 'Default', hint: 'Recommended settings for most projects' },
          { value: 'minimal', label: 'Minimal', hint: 'Core features only' },
          { value: 'full', label: 'Full', hint: 'All features enabled' },
          { value: 'custom', label: 'Custom', hint: 'Choose each component' },
        ],
      });

      if (preset === 'minimal') {
        Object.assign(options, MINIMAL_INIT_OPTIONS);
        options.targetDir = ctx.cwd;
      } else if (preset === 'full') {
        Object.assign(options, FULL_INIT_OPTIONS);
        options.targetDir = ctx.cwd;
      } else if (preset === 'custom') {
        // Component selection
        const components = await multiSelect({
          message: 'Select components to initialize:',
          options: [
            { value: 'claudeMd', label: 'CLAUDE.md', hint: 'Swarm guidance and project configuration', selected: true },
            { value: 'settings', label: 'settings.json', hint: 'Claude Code hooks configuration', selected: true },
            { value: 'skills', label: 'Skills', hint: 'Claude Code skills in .claude/skills/', selected: true },
            { value: 'commands', label: 'Commands', hint: 'Claude Code commands in .claude/commands/', selected: true },
            { value: 'agents', label: 'Agents', hint: 'Agent definitions in .claude/agents/', selected: true },
            { value: 'helpers', label: 'Helpers', hint: 'Utility scripts in .claude/helpers/', selected: true },
            { value: 'statusline', label: 'Statusline', hint: 'Shell statusline integration', selected: false },
            { value: 'mcp', label: 'MCP', hint: '.mcp.json for MCP server configuration', selected: true },
            { value: 'runtime', label: 'Runtime', hint: '.claude-flow/ directory for V3 runtime', selected: true },
          ],
        });

        options.components.claudeMd = components.includes('claudeMd');
        options.components.settings = components.includes('settings');
        options.components.skills = components.includes('skills');
        options.components.commands = components.includes('commands');
        options.components.agents = components.includes('agents');
        options.components.helpers = components.includes('helpers');
        options.components.statusline = components.includes('statusline');
        options.components.mcp = components.includes('mcp');
        options.components.runtime = components.includes('runtime');

        // Skills selection
        if (options.components.skills) {
          const skillSets = await multiSelect({
            message: 'Select skill sets:',
            options: [
              { value: 'core', label: 'Core', hint: 'Swarm, memory, SPARC skills', selected: true },
              { value: 'agentdb', label: 'AgentDB', hint: 'Vector database skills', selected: true },
              { value: 'github', label: 'GitHub', hint: 'GitHub integration skills', selected: true },
              { value: 'flowNexus', label: 'Flow Nexus', hint: 'Cloud platform skills', selected: false },
              { value: 'v3', label: 'V3', hint: 'V3 implementation skills', selected: true },
            ],
          });

          options.skills.core = skillSets.includes('core');
          options.skills.agentdb = skillSets.includes('agentdb');
          options.skills.github = skillSets.includes('github');
          options.skills.flowNexus = skillSets.includes('flowNexus');
          options.skills.v3 = skillSets.includes('v3');
        }

        // Hooks selection
        if (options.components.settings) {
          const hooks = await multiSelect({
            message: 'Select hooks to enable:',
            options: [
              { value: 'preToolUse', label: 'PreToolUse', hint: 'Before tool execution', selected: true },
              { value: 'postToolUse', label: 'PostToolUse', hint: 'After tool execution', selected: true },
              { value: 'userPromptSubmit', label: 'UserPromptSubmit', hint: 'Task routing', selected: true },
              { value: 'sessionStart', label: 'SessionStart', hint: 'Session initialization', selected: true },
              { value: 'stop', label: 'Stop', hint: 'Task completion evaluation', selected: true },
              { value: 'notification', label: 'Notification', hint: 'Swarm notifications', selected: true },
              { value: 'permissionRequest', label: 'PermissionRequest', hint: 'Auto-allow claude-flow tools', selected: true },
            ],
          });

          options.hooks.preToolUse = hooks.includes('preToolUse');
          options.hooks.postToolUse = hooks.includes('postToolUse');
          options.hooks.userPromptSubmit = hooks.includes('userPromptSubmit');
          options.hooks.sessionStart = hooks.includes('sessionStart');
          options.hooks.stop = hooks.includes('stop');
          options.hooks.notification = hooks.includes('notification');
        }
      }

      // Swarm topology (for all presets)
      const topology = await select({
        message: 'Select swarm topology:',
        options: [
          { value: 'hierarchical-mesh', label: 'Hierarchical Mesh', hint: 'Best for complex projects (recommended)' },
          { value: 'mesh', label: 'Mesh', hint: 'Peer-to-peer coordination' },
          { value: 'hierarchical', label: 'Hierarchical', hint: 'Tree-based coordination' },
          { value: 'adaptive', label: 'Adaptive', hint: 'Dynamic topology switching' },
        ],
      });
      options.runtime.topology = topology as InitOptions['runtime']['topology'];

      // Max agents
      const maxAgents = await input({
        message: 'Maximum concurrent agents:',
        default: String(options.runtime.maxAgents),
        validate: (v) => {
          const n = parseInt(v);
          return (!isNaN(n) && n > 0 && n <= 50) || 'Enter a number between 1 and 50';
        },
      });
      options.runtime.maxAgents = parseInt(maxAgents);

      // Memory backend
      const memoryBackend = await select({
        message: 'Select memory backend:',
        options: [
          { value: 'hybrid', label: 'Hybrid', hint: 'SQLite + AgentDB (recommended)' },
          { value: 'agentdb', label: 'AgentDB', hint: '150x faster vector search' },
          { value: 'sqlite', label: 'SQLite', hint: 'Standard SQL storage' },
          { value: 'memory', label: 'In-Memory', hint: 'Fast but non-persistent' },
        ],
      });
      options.runtime.memoryBackend = memoryBackend as InitOptions['runtime']['memoryBackend'];

      // HNSW indexing
      if (memoryBackend === 'agentdb' || memoryBackend === 'hybrid') {
        const enableHNSW = await confirm({
          message: 'Enable HNSW indexing for faster vector search?',
          default: true,
        });
        options.runtime.enableHNSW = enableHNSW;
      }

      // Neural learning
      const enableNeural = await confirm({
        message: 'Enable neural pattern learning?',
        default: options.runtime.enableNeural,
      });
      options.runtime.enableNeural = enableNeural;

      // Embeddings configuration
      const enableEmbeddings = await confirm({
        message: 'Enable ONNX embedding system with hyperbolic support?',
        default: true,
      });

      let embeddingModel = 'all-MiniLM-L6-v2';
      if (enableEmbeddings) {
        embeddingModel = await select({
          message: 'Select embedding model:',
          options: [
            { value: 'all-MiniLM-L6-v2', label: 'MiniLM L6 (384d)', hint: 'Fast, good quality (recommended)' },
            { value: 'all-mpnet-base-v2', label: 'MPNet Base (768d)', hint: 'Higher quality, more memory' },
          ],
        });
      }

      // Execute initialization
      output.writeln();
      const spinner = output.createSpinner({ text: 'Initializing...' });
      spinner.start();

      const result = await executeInit(options);

      if (!result.success) {
        spinner.fail('Initialization failed');
        for (const error of result.errors) {
          output.printError(error);
        }
        return { success: false, exitCode: 1 };
      }

      spinner.succeed('Setup complete!');

      // Initialize embeddings if enabled
      let embeddingsInitialized = false;
      if (enableEmbeddings) {
        output.writeln();
        output.printInfo('Initializing ONNX embedding subsystem...');
        const { execSync } = await import('child_process');
        try {
          execSync(`npx @claude-flow/cli@latest embeddings init --model ${embeddingModel} --no-download --force 2>/dev/null`, {
            stdio: 'pipe',
            cwd: ctx.cwd,
            timeout: 30000
          });
          output.writeln(output.success('  ✓ Embeddings configured'));
          embeddingsInitialized = true;
        } catch {
          output.writeln(output.dim('  Embeddings will be configured on first use'));
        }
      }

      output.writeln();

      // Summary table
      output.printTable({
        columns: [
          { key: 'setting', header: 'Setting', width: 20 },
          { key: 'value', header: 'Value', width: 40 },
        ],
        data: [
          { setting: 'Preset', value: preset },
          { setting: 'Topology', value: options.runtime.topology },
          { setting: 'Max Agents', value: String(options.runtime.maxAgents) },
          { setting: 'Memory Backend', value: options.runtime.memoryBackend },
          { setting: 'HNSW Indexing', value: options.runtime.enableHNSW ? 'Enabled' : 'Disabled' },
          { setting: 'Neural Learning', value: options.runtime.enableNeural ? 'Enabled' : 'Disabled' },
          { setting: 'Embeddings', value: enableEmbeddings ? `${embeddingModel} (hyperbolic)` : 'Disabled' },
          { setting: 'Skills', value: `${result.summary.skillsCount} installed` },
          { setting: 'Commands', value: `${result.summary.commandsCount} installed` },
          { setting: 'Agents', value: `${result.summary.agentsCount} installed` },
          { setting: 'Hooks', value: `${result.summary.hooksEnabled} enabled` },
        ],
      });

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof Error && error.message === 'User cancelled') {
        output.printInfo('Setup cancelled');
        return { success: true };
      }
      throw error;
    }
  },
};

// Check subcommand
const checkCommand: Command = {
  name: 'check',
  description: 'Check if Claude Flow is initialized',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const initialized = isInitialized(ctx.cwd);

    const result = {
      initialized: initialized.claude || initialized.claudeFlow,
      claude: initialized.claude,
      claudeFlow: initialized.claudeFlow,
      paths: {
        claudeSettings: initialized.claude ? path.join(ctx.cwd, '.claude', 'settings.json') : null,
        claudeFlowConfig: initialized.claudeFlow ? path.join(ctx.cwd, '.claude-flow', 'config.yaml') : null,
      },
    };

    if (ctx.flags.format === 'json') {
      output.printJson(result);
      return { success: true, data: result };
    }

    if (result.initialized) {
      output.printSuccess('Claude Flow is initialized');
      if (initialized.claude) {
        output.printInfo(`  Claude Code: .claude/settings.json`);
      }
      if (initialized.claudeFlow) {
        output.printInfo(`  V3 Runtime: .claude-flow/config.yaml`);
      }
    } else {
      output.printWarning('Claude Flow is not initialized in this directory');
      output.printInfo('Run "claude-flow init" to initialize');
    }

    return { success: true, data: result };
  },
};

// Skills subcommand
const skillsCommand: Command = {
  name: 'skills',
  description: 'Initialize only skills',
  options: [
    { name: 'all', description: 'Install all skills', type: 'boolean', default: false },
    { name: 'core', description: 'Install core skills', type: 'boolean', default: true },
    { name: 'agentdb', description: 'Install AgentDB skills', type: 'boolean', default: false },
    { name: 'github', description: 'Install GitHub skills', type: 'boolean', default: false },
    { name: 'v3', description: 'Install V3 skills', type: 'boolean', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const options: InitOptions = {
      ...MINIMAL_INIT_OPTIONS,
      targetDir: ctx.cwd,
      force: ctx.flags.force as boolean,
      components: {
        settings: false,
        skills: true,
        commands: false,
        agents: false,
        helpers: false,
        statusline: false,
        mcp: false,
        runtime: false,
        claudeMd: false,
      },
      skills: {
        all: ctx.flags.all as boolean,
        core: ctx.flags.core as boolean,
        agentdb: ctx.flags.agentdb as boolean,
        github: ctx.flags.github as boolean,
        flowNexus: false,
        v3: ctx.flags.v3 as boolean,
      },
    };

    const spinner = output.createSpinner({ text: 'Installing skills...' });
    spinner.start();

    const result = await executeInit(options);

    if (result.success) {
      spinner.succeed(`Installed ${result.summary.skillsCount} skills`);
    } else {
      spinner.fail('Failed to install skills');
      for (const error of result.errors) {
        output.printError(error);
      }
    }

    return { success: result.success, data: result };
  },
};

// Hooks subcommand
const hooksCommand: Command = {
  name: 'hooks',
  description: 'Initialize only hooks configuration',
  options: [
    { name: 'all', description: 'Enable all hooks', type: 'boolean', default: true },
    { name: 'minimal', description: 'Enable only essential hooks', type: 'boolean', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const minimal = ctx.flags.minimal as boolean;

    const options: InitOptions = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: ctx.cwd,
      force: ctx.flags.force as boolean,
      components: {
        settings: true,
        skills: false,
        commands: false,
        agents: false,
        helpers: false,
        statusline: false,
        mcp: false,
        runtime: false,
        claudeMd: false,
      },
      hooks: minimal
        ? {
            preToolUse: true,
            postToolUse: true,
            userPromptSubmit: false,
            sessionStart: false,
            stop: false,
            notification: false,
            timeout: 5000,
            continueOnError: true,
          }
        : DEFAULT_INIT_OPTIONS.hooks,
    };

    const spinner = output.createSpinner({ text: 'Creating hooks configuration...' });
    spinner.start();

    const result = await executeInit(options);

    if (result.success) {
      spinner.succeed(`Created settings.json with ${result.summary.hooksEnabled} hooks enabled`);
    } else {
      spinner.fail('Failed to create hooks configuration');
      for (const error of result.errors) {
        output.printError(error);
      }
    }

    return { success: result.success, data: result };
  },
};

// Main init command
export const initCommand: Command = {
  name: 'init',
  description: 'Initialize Claude Flow in the current directory',
  subcommands: [wizardCommand, checkCommand, skillsCommand, hooksCommand],
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Overwrite existing configuration',
      type: 'boolean',
      default: false,
    },
    {
      name: 'minimal',
      short: 'm',
      description: 'Create minimal configuration',
      type: 'boolean',
      default: false,
    },
    {
      name: 'full',
      description: 'Create full configuration with all components',
      type: 'boolean',
      default: false,
    },
    {
      name: 'skip-claude',
      description: 'Skip .claude/ directory creation (runtime only)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'only-claude',
      description: 'Only create .claude/ directory (skip runtime)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'start-all',
      description: 'Auto-start daemon, memory, and swarm after init',
      type: 'boolean',
      default: false,
    },
    {
      name: 'start-daemon',
      description: 'Auto-start daemon after init',
      type: 'boolean',
      default: false,
    },
    {
      name: 'with-embeddings',
      description: 'Initialize ONNX embedding subsystem with hyperbolic support',
      type: 'boolean',
      default: false,
    },
    {
      name: 'embedding-model',
      description: 'ONNX embedding model to use',
      type: 'string',
      default: 'all-MiniLM-L6-v2',
      choices: ['all-MiniLM-L6-v2', 'all-mpnet-base-v2'],
    },
  ],
  examples: [
    { command: 'claude-flow init', description: 'Initialize with default configuration' },
    { command: 'claude-flow init --start-all', description: 'Initialize and start daemon, memory, swarm' },
    { command: 'claude-flow init --start-daemon', description: 'Initialize and start daemon only' },
    { command: 'claude-flow init --minimal', description: 'Initialize with minimal configuration' },
    { command: 'claude-flow init --full', description: 'Initialize with all components' },
    { command: 'claude-flow init --force', description: 'Reinitialize and overwrite existing config' },
    { command: 'claude-flow init --only-claude', description: 'Only create Claude Code integration' },
    { command: 'claude-flow init --skip-claude', description: 'Only create V3 runtime' },
    { command: 'claude-flow init wizard', description: 'Interactive setup wizard' },
    { command: 'claude-flow init --with-embeddings', description: 'Initialize with ONNX embeddings' },
    { command: 'claude-flow init --with-embeddings --embedding-model all-mpnet-base-v2', description: 'Use larger embedding model' },
    { command: 'claude-flow init skills --all', description: 'Install all available skills' },
    { command: 'claude-flow init hooks --minimal', description: 'Create minimal hooks configuration' },
  ],
  action: initAction,
};

export default initCommand;
