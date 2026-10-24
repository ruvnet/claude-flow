/**
 * Init Executor
 * Main execution logic for V3 initialization
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import type { InitOptions, InitResult, PlatformInfo } from './types.js';
import { detectPlatform } from './types.js';
import { generateSettingsJson } from './settings-generator.js';
import { generateMCPJson } from './mcp-generator.js';
import { generateStatuslineScript, generateStatuslineHook } from './statusline-generator.js';
import {
  generatePreCommitHook,
  generatePostCommitHook,
  generateSessionManager,
  generateAgentRouter,
  generateMemoryHelper,
} from './helpers-generator.js';
import { generateClaudeMd, generateMinimalClaudeMd } from './claudemd-generator.js';

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
    }

    // Generate statusline
    if (options.components.statusline) {
      await writeStatusline(targetDir, options, result);
    }

    // Generate runtime config
    if (options.components.runtime) {
      await writeRuntimeConfig(targetDir, options, result);
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

  if (fs.existsSync(settingsPath) && !options.force) {
    result.skipped.push('.claude/settings.json');
    return;
  }

  const content = generateSettingsJson(options);
  fs.writeFileSync(settingsPath, content, 'utf-8');
  result.created.files.push('.claude/settings.json');
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
    result.skipped.push('.mcp.json');
    return;
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
    if (skillsConfig.v3) skillsToCopy.push(...SKILLS_MAP.v3);
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
    // V3-specific agent categories
    if (agentsConfig.v3) agentsToCopy.push(...(AGENTS_MAP.v3 || []));
    if (agentsConfig.optimization) agentsToCopy.push(...(AGENTS_MAP.optimization || []));
    if (agentsConfig.testing) agentsToCopy.push(...(AGENTS_MAP.testing || []));
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
        // Count agent files (.yaml and .md)
        const yamlFiles = countFiles(sourcePath, '.yaml');
        const mdFiles = countFiles(sourcePath, '.md');
        result.summary.agentsCount += yamlFiles + mdFiles;
        result.created.files.push(`.claude/agents/${agentCategory}`);
      } else {
        result.skipped.push(`.claude/agents/${agentCategory}`);
      }
    }
  }
}

/**
 * Find source helpers directory
 */
function findSourceHelpersDir(sourceBaseDir?: string): string | null {
  const possiblePaths: string[] = [];

  // If explicit source base directory is provided, check it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude', 'helpers'));
  }

  // IMPORTANT: Check the package's own .claude/helpers directory
  // This is the primary path when running as an npm package
  // __dirname is typically /path/to/node_modules/@claude-flow/cli/dist/src/init
  // We need to go up 3 levels to reach the package root (dist/src/init -> dist/src -> dist -> root)
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageHelpers = path.join(packageRoot, '.claude', 'helpers');
  if (fs.existsSync(packageHelpers)) {
    possiblePaths.unshift(packageHelpers); // Add to beginning (highest priority)
  }

  // From dist/src/init -> go up to project root
  let currentDir = __dirname;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    const helpersPath = path.join(parentDir, '.claude', 'helpers');
    if (fs.existsSync(helpersPath)) {
      possiblePaths.push(helpersPath);
    }
    currentDir = parentDir;
  }

  // Also check relative to process.cwd() for development
  const cwdBased = [
    path.join(process.cwd(), '.claude', 'helpers'),
    path.join(process.cwd(), '..', '.claude', 'helpers'),
    path.join(process.cwd(), '..', '..', '.claude', 'helpers'),
  ];
  possiblePaths.push(...cwdBased);

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
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

  let copiedAdvanced = false;
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
          copiedAdvanced = true;
        } else {
          result.skipped.push(`.claude/${file.dest}`);
        }
      }
    }
  }

  // Fall back to generating simple statusline if advanced files not available
  if (!copiedAdvanced) {
    const statuslineScript = generateStatuslineScript(options);
    const statuslineHook = generateStatuslineHook(options);

    const files: Record<string, string> = {
      'statusline.cjs': statuslineScript,  // .cjs for ES module project compatibility
      'statusline-hook.sh': statuslineHook,
    };

    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(helpersDir, name);

      if (!fs.existsSync(filePath) || options.force) {
        fs.writeFileSync(filePath, content, 'utf-8');
        result.created.files.push(`.claude/helpers/${name}`);
      } else {
        result.skipped.push(`.claude/helpers/${name}`);
      }
    }
  }
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

  const config = `# Claude Flow V3 Runtime Configuration
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
    return;
  }

  // Use minimal version for minimal init, full version otherwise
  const isMinimal = !options.components.commands && !options.components.agents;
  const content = isMinimal ? generateMinimalClaudeMd(options) : generateClaudeMd(options);

  fs.writeFileSync(claudeMdPath, content, 'utf-8');
  result.created.files.push('CLAUDE.md');
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
  if (hooks.notification) count++;

  return count;
}

export default executeInit;
