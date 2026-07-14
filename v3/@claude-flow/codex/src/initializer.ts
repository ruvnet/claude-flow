/**
 * @claude-flow/codex - CodexInitializer
 *
 * Main initialization class for setting up Codex projects
 */

import fs from 'fs-extra';
import path from 'path';
import type {
  CodexInitOptions,
  CodexInitResult,
  AgentsMdTemplate,
  BuiltInSkill,
} from './types.js';
import { generateAgentsMd } from './generators/agents-md.js';
import { generateSkillMd, generateBuiltInSkill } from './generators/skill-md.js';
import { generateConfigToml } from './generators/config-toml.js';
import { DEFAULT_SKILLS_BY_TEMPLATE, AGENTS_OVERRIDE_TEMPLATE, GITIGNORE_ENTRIES, ALL_AVAILABLE_SKILLS } from './templates/index.js';

/**
 * Bundled skills source directory (relative to package)
 */
const BUNDLED_SKILLS_DIR = '../../../../.agents/skills';

/**
 * Main initializer for Codex projects
 */
export class CodexInitializer {
  private projectPath: string = '';
  private template: AgentsMdTemplate = 'default';
  private skills: string[] = [];
  private force: boolean = false;
  private dual: boolean = false;
  private bundledSkillsPath: string = '';

  /**
   * Initialize a new Codex project
   */
  async initialize(options: CodexInitOptions): Promise<CodexInitResult> {
    this.projectPath = path.resolve(options.projectPath);
    this.template = options.template ?? 'default';
    this.skills = options.skills ?? DEFAULT_SKILLS_BY_TEMPLATE[this.template];
    this.force = options.force ?? false;
    this.dual = options.dual ?? false;

    // Resolve bundled skills path (relative to this file's location)
    this.bundledSkillsPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      BUNDLED_SKILLS_DIR
    );

    const filesCreated: string[] = [];
    const skillsGenerated: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      // Validate project path
      await this.validateProjectPath();

      // Check if already initialized
      const alreadyInitialized = await this.isAlreadyInitialized();
      if (alreadyInitialized && !this.force) {
        return {
          success: false,
          filesCreated,
          skillsGenerated,
          warnings: ['Project already initialized. Use --force to overwrite.'],
          errors: ['Project already initialized'],
        };
      }

      if (alreadyInitialized && this.force) {
        warnings.push('Overwriting existing configuration files');
      }

      // Create directory structure
      await this.createDirectoryStructure();

      // Generate AGENTS.md
      const agentsMd = await this.generateAgentsMd();
      const agentsMdPath = path.join(this.projectPath, 'AGENTS.md');

      if (await this.shouldWriteFile(agentsMdPath)) {
        await fs.writeFile(agentsMdPath, agentsMd, 'utf-8');
        filesCreated.push('AGENTS.md');
      } else {
        warnings.push('AGENTS.md already exists - skipped');
      }

      // Generate config.toml
      const configToml = await this.generateConfigToml();
      const configTomlPath = path.join(this.projectPath, '.agents', 'config.toml');

      if (await this.shouldWriteFile(configTomlPath)) {
        await fs.writeFile(configTomlPath, configToml, 'utf-8');
        filesCreated.push('.agents/config.toml');
      } else {
        warnings.push('.agents/config.toml already exists - skipped');
      }

      // Copy bundled skills first (for full/enterprise templates or specific skills)
      const bundledResult = await this.copyBundledSkills();
      skillsGenerated.push(...bundledResult.copied);
      warnings.push(...bundledResult.warnings);

      // For skills not bundled, generate from templates
      for (const skillName of this.skills) {
        // Skip if already copied as bundled skill
        if (bundledResult.copied.includes(skillName)) {
          filesCreated.push(`.agents/skills/${skillName}/SKILL.md`);
          continue;
        }

        try {
          const skillResult = await this.generateSkill(skillName);
          if (skillResult.created) {
            skillsGenerated.push(skillName);
            filesCreated.push(skillResult.path);
          } else if (skillResult.skipped) {
            // Only warn if not already in bundled warnings
            if (!bundledResult.warnings.some(w => w.includes(skillName))) {
              warnings.push(`Skill ${skillName} already exists - skipped`);
            }
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to generate skill ${skillName}: ${errorMessage}`);
        }
      }

      // Generate local overrides template
      const overridePath = path.join(this.projectPath, '.codex', 'AGENTS.override.md');
      if (await this.shouldWriteFile(overridePath)) {
        await fs.writeFile(overridePath, AGENTS_OVERRIDE_TEMPLATE, 'utf-8');
        filesCreated.push('.codex/AGENTS.override.md');
      }

      // Generate local config.toml
      const localConfigPath = path.join(this.projectPath, '.codex', 'config.toml');
      if (await this.shouldWriteFile(localConfigPath)) {
        await fs.writeFile(localConfigPath, await this.generateLocalConfigToml(), 'utf-8');
        filesCreated.push('.codex/config.toml');
      }

      // Update .gitignore
      const gitignoreUpdated = await this.updateGitignore();
      if (gitignoreUpdated) {
        filesCreated.push('.gitignore (updated)');
      }

      // Register MCP server with Codex
      const mcpResult = await this.registerMCPServer();
      if (mcpResult.registered) {
        filesCreated.push('MCP server (ruflo) registered');
      }
      if (mcpResult.warning) {
        warnings.push(mcpResult.warning);
      }

      // If dual mode, also generate Claude Code files
      if (this.dual) {
        const dualResult = await this.generateDualPlatformFiles();
        filesCreated.push(...dualResult.files);
        if (dualResult.warnings) {
          warnings.push(...dualResult.warnings);
        }
      }

      // Create a README for the .agents directory
      const agentsReadmePath = path.join(this.projectPath, '.agents', 'README.md');
      if (await this.shouldWriteFile(agentsReadmePath)) {
        await fs.writeFile(agentsReadmePath, this.generateAgentsReadme(), 'utf-8');
        filesCreated.push('.agents/README.md');
      }

      const result: CodexInitResult = {
        success: true,
        filesCreated,
        skillsGenerated,
      };
      if (warnings.length > 0) {
        result.warnings = warnings;
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      errors.push(errorMessage);
      const result: CodexInitResult = {
        success: false,
        filesCreated,
        skillsGenerated,
        errors,
      };
      if (warnings.length > 0) {
        result.warnings = warnings;
      }
      return result;
    }
  }

  /**
   * Validate that the project path is valid and writable
   */
  private async validateProjectPath(): Promise<void> {
    try {
      await fs.ensureDir(this.projectPath);

      // Check write permissions by attempting to create a temp file
      const tempFile = path.join(this.projectPath, '.codex-init-test');
      await fs.writeFile(tempFile, 'test', 'utf-8');
      await fs.remove(tempFile);
    } catch (error) {
      throw new Error(`Cannot write to project path: ${this.projectPath}`);
    }
  }

  /**
   * Check if project is already initialized
   */
  private async isAlreadyInitialized(): Promise<boolean> {
    const agentsMdExists = await fs.pathExists(path.join(this.projectPath, 'AGENTS.md'));
    const agentsConfigExists = await fs.pathExists(path.join(this.projectPath, '.agents', 'config.toml'));
    return agentsMdExists || agentsConfigExists;
  }

  /**
   * Check if we should write a file (force mode or doesn't exist)
   */
  private async shouldWriteFile(filePath: string): Promise<boolean> {
    if (this.force) {
      return true;
    }
    return !(await fs.pathExists(filePath));
  }

  /**
   * Create the directory structure
   */
  private async createDirectoryStructure(): Promise<void> {
    const dirs = [
      '.agents',
      '.agents/skills',
      '.codex',
      '.claude-flow',
      '.claude-flow/data',
      '.claude-flow/logs',
    ];

    for (const dir of dirs) {
      const fullPath = path.join(this.projectPath, dir);
      await fs.ensureDir(fullPath);
    }
  }

  /**
   * Copy bundled skills from the package or source directory
   * Returns the list of skills copied
   */
  private async copyBundledSkills(): Promise<{ copied: string[]; warnings: string[] }> {
    const copied: string[] = [];
    const warnings: string[] = [];

    // Check if bundled skills directory exists
    if (!await fs.pathExists(this.bundledSkillsPath)) {
      warnings.push(`Bundled skills directory not found: ${this.bundledSkillsPath}`);
      return { copied, warnings };
    }

    const destSkillsDir = path.join(this.projectPath, '.agents', 'skills');

    // Get all skill directories
    const skillDirs = await fs.readdir(this.bundledSkillsPath, { withFileTypes: true });

    for (const dirent of skillDirs) {
      if (!dirent.isDirectory()) continue;

      const skillName = dirent.name;
      const srcPath = path.join(this.bundledSkillsPath, skillName);
      const destPath = path.join(destSkillsDir, skillName);

      // Skip if skill should be filtered (based on template)
      // For 'full' and 'enterprise' templates, include all skills
      const includeAll = this.template === 'full' || this.template === 'enterprise';
      if (!includeAll && !this.skills.includes(skillName)) {
        continue;
      }

      try {
        // Check if skill already exists and we're not forcing
        if (!this.force && await fs.pathExists(destPath)) {
          warnings.push(`Skill ${skillName} already exists - skipped`);
          continue;
        }

        // Copy the entire skill directory
        await fs.copy(srcPath, destPath, { overwrite: this.force });
        copied.push(skillName);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        warnings.push(`Failed to copy skill ${skillName}: ${errorMessage}`);
      }
    }

    return { copied, warnings };
  }

  /**
   * Check if a skill is bundled (exists in source directory)
   */
  private async isBundledSkill(skillName: string): Promise<boolean> {
    const skillPath = path.join(this.bundledSkillsPath, skillName);
    return fs.pathExists(skillPath);
  }

  /**
   * Register claude-flow as MCP server with Codex
   */
  private async registerMCPServer(): Promise<{ registered: boolean; warning?: string }> {
    try {
      const { execSync } = await import('child_process');

      // Check if codex CLI is available
      try {
        execSync('which codex', { stdio: 'pipe' });
      } catch {
        return {
          registered: false,
          warning: 'Codex CLI not found. Run: codex mcp add ruflo -- npx ruflo mcp start',
        };
      }

      // Check if already registered. Prefer the structured `--json` output
      // (each entry has a `name` field — confirmed current as of the 2026
      // `codex mcp` CLI) over a plain substring match against the human
      // -readable table, which false-positives on any server whose name or
      // command merely contains "ruflo" and breaks silently if the table
      // formatting changes.
      try {
        const listJson = execSync('codex mcp list --json 2>&1', { encoding: 'utf-8' });
        const parsed = JSON.parse(listJson);
        // Confirmed shape (2026 `codex mcp` CLI) is a bare array; tolerate a
        // future `{ servers: [...] }` wrapper but otherwise treat an
        // unrecognized shape as "unknown" rather than silently concluding
        // not-registered — falls through to the safe text-based fallback.
        const servers = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.servers) ? parsed.servers : null;
        if (!servers) throw new Error('unrecognized `codex mcp list --json` shape');
        if (servers.some((s: unknown) => s && typeof s === 'object' && (s as { name?: unknown }).name === 'ruflo')) {
          return { registered: true }; // Already registered
        }
      } catch {
        // --json unsupported (older codex CLI) or unparsable — fall back to
        // the plain-text listing so registration still no-ops idempotently.
        try {
          const list = execSync('codex mcp list 2>&1', { encoding: 'utf-8' });
          if (list.includes('ruflo')) {
            return { registered: true };
          }
        } catch {
          // Ignore list errors — fall through to (re-)register below.
        }
      }

      // Register the MCP server
      try {
        execSync('codex mcp add ruflo -- npx ruflo mcp start', {
          stdio: 'pipe',
          timeout: 10000,
        });
        return { registered: true };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          registered: false,
          warning: `Failed to register MCP server: ${errorMessage}. Run manually: codex mcp add ruflo -- npx ruflo mcp start`,
        };
      }
    } catch {
      return {
        registered: false,
        warning: 'Could not register MCP server. Run manually: codex mcp add ruflo -- npx ruflo mcp start',
      };
    }
  }

  /**
   * Generate AGENTS.md content
   */
  private async generateAgentsMd(): Promise<string> {
    const projectName = path.basename(this.projectPath);

    return generateAgentsMd({
      projectName,
      template: this.template,
      skills: this.skills,
    });
  }

  /**
   * Generate config.toml content
   */
  private async generateConfigToml(): Promise<string> {
    return generateConfigToml({
      skills: this.skills.map(skill => ({
        path: `.agents/skills/${skill}`,
        enabled: true,
      })),
    });
  }

  /**
   * Generate local config.toml for .codex directory
   */
  private async generateLocalConfigToml(): Promise<string> {
    return `# Local Codex Configuration
# This file overrides .agents/config.toml for local development
# DO NOT commit this file to version control

# Development profile - more permissive
approval_policy = "never"
sandbox_mode = "danger-full-access"
web_search = "live"

# Debug settings
# Uncomment to enable debug logging
# CODEX_LOG_LEVEL = "debug"

# Local MCP server overrides
# [mcp_servers.local]
# command = "node"
# args = ["./local-mcp-server.js"]
# enabled = true

# Environment-specific settings
# [env]
# ANTHROPIC_API_KEY = "your-local-key"
`;
  }

  /**
   * Generate a skill
   */
  private async generateSkill(skillName: string): Promise<{ created: boolean; skipped: boolean; path: string }> {
    const skillDir = path.join(this.projectPath, '.agents', 'skills', skillName);
    const skillPath = path.join(skillDir, 'SKILL.md');

    // Check if skill already exists
    if (!this.force && await fs.pathExists(skillPath)) {
      return { created: false, skipped: true, path: `.agents/skills/${skillName}/SKILL.md` };
    }

    await fs.ensureDir(skillDir);

    // Check if it's a built-in skill
    const builtInSkills: BuiltInSkill[] = [
      'swarm-orchestration',
      'memory-management',
      'sparc-methodology',
      'security-audit',
      'performance-analysis',
      'github-automation',
    ];

    let skillMd: string;

    if (builtInSkills.includes(skillName as BuiltInSkill)) {
      const result = await generateBuiltInSkill(skillName);
      skillMd = result.skillMd;

      // Also write any associated scripts or references
      if (Object.keys(result.scripts).length > 0) {
        const scriptsDir = path.join(skillDir, 'scripts');
        await fs.ensureDir(scriptsDir);
        for (const [scriptName, scriptContent] of Object.entries(result.scripts)) {
          await fs.writeFile(path.join(scriptsDir, scriptName), scriptContent, 'utf-8');
        }
      }

      if (Object.keys(result.references).length > 0) {
        const refsDir = path.join(skillDir, 'docs');
        await fs.ensureDir(refsDir);
        for (const [refName, refContent] of Object.entries(result.references)) {
          await fs.writeFile(path.join(refsDir, refName), refContent, 'utf-8');
        }
      }
    } else {
      // Generate a custom skill template
      skillMd = await generateSkillMd({
        name: skillName,
        description: `Custom skill: ${skillName}`,
        triggers: ['Define when to trigger this skill'],
        skipWhen: ['Define when to skip this skill'],
      });
    }

    await fs.writeFile(skillPath, skillMd, 'utf-8');

    return { created: true, skipped: false, path: `.agents/skills/${skillName}/SKILL.md` };
  }

  /**
   * Update .gitignore with Codex entries
   */
  private async updateGitignore(): Promise<boolean> {
    const gitignorePath = path.join(this.projectPath, '.gitignore');
    let content = '';

    if (await fs.pathExists(gitignorePath)) {
      content = await fs.readFile(gitignorePath, 'utf-8');
    }

    // Check if Codex entries already exist
    if (content.includes('.codex/')) {
      return false; // Already has entries
    }

    // Add entries with proper spacing
    const separator = content.length > 0 && !content.endsWith('\n') ? '\n\n' : '\n';
    const newContent = content + separator + GITIGNORE_ENTRIES.join('\n') + '\n';
    await fs.writeFile(gitignorePath, newContent, 'utf-8');
    return true;
  }

  /**
   * Generate README for .agents directory
   */
  private generateAgentsReadme(): string {
    return `# .agents Directory

This directory contains agent configuration and skills for OpenAI Codex CLI.

## Structure

\`\`\`
.agents/
  config.toml     # Main configuration file
  skills/         # Skill definitions
    skill-name/
      SKILL.md    # Skill instructions
      scripts/    # Optional scripts
      docs/       # Optional documentation
  README.md       # This file
\`\`\`

## Configuration

The \`config.toml\` file controls:
- Model selection
- Approval policies
- Sandbox modes
- MCP server connections
- Skills configuration

## Skills

Skills are invoked using \`$skill-name\` syntax. Each skill has:
- YAML frontmatter with metadata
- Trigger and skip conditions
- Commands and examples

## Documentation

- Main instructions: \`AGENTS.md\` (project root)
- Local overrides: \`.codex/AGENTS.override.md\` (gitignored)
- Ruflo: https://github.com/ruvnet/ruflo
`;
  }

  /**
   * Generate dual-platform files (Claude Code + Codex)
   */
  private async generateDualPlatformFiles(): Promise<{ files: string[]; warnings?: string[] }> {
    const files: string[] = [];
    const warnings: string[] = [];

    // Check if CLAUDE.md already exists
    const claudeMdPath = path.join(this.projectPath, 'CLAUDE.md');
    const claudeMdExists = await fs.pathExists(claudeMdPath);

    if (claudeMdExists && !this.force) {
      warnings.push('CLAUDE.md already exists - not overwriting. Use --force to replace.');
      return { files, warnings };
    }

    const projectName = path.basename(this.projectPath);

    // Generate a CLAUDE.md that references AGENTS.md
    const claudeMd = `# ${projectName}

> This project supports both Claude Code and OpenAI Codex.

## Platform Compatibility

| Platform | Config File | Skill Syntax |
|----------|-------------|--------------|
| Claude Code | CLAUDE.md | /skill-name |
| OpenAI Codex | AGENTS.md | $skill-name |

## Instructions

**Primary instructions are in \`AGENTS.md\`** (Agentic AI Foundation standard).

This file provides compatibility for Claude Code users.

## Quick Start

\`\`\`bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
\`\`\`

## Available Skills

Both platforms share the same skills in \`.agents/skills/\`:

${this.skills.map(s => `- \`$${s}\` (Codex) / \`/${s}\` (Claude Code)`).join('\n')}

## Configuration

### Codex Configuration
- Main: \`.agents/config.toml\`
- Local: \`.codex/config.toml\` (gitignored)

### Claude Code Configuration
- This file: \`CLAUDE.md\`
- Local: \`CLAUDE.local.md\` (gitignored)

## MCP Integration

\`\`\`bash
# Start MCP server
npx ruflo mcp start
\`\`\`

## Swarm Orchestration

This project uses hierarchical swarm coordination:

| Setting | Value |
|---------|-------|
| Topology | hierarchical |
| Max Agents | 8 |
| Strategy | specialized |

## Code Standards

- Files under 500 lines
- No hardcoded secrets
- Input validation at boundaries
- Typed interfaces for APIs

## Security

- NEVER commit .env files or secrets
- Always validate user input
- Use parameterized queries for SQL

## Full Documentation

For complete instructions, see \`AGENTS.md\`.

---

*Generated by @claude-flow/codex - Dual platform mode*
`;

    await fs.writeFile(claudeMdPath, claudeMd, 'utf-8');
    files.push('CLAUDE.md');

    // Generate CLAUDE.local.md template
    const claudeLocalPath = path.join(this.projectPath, 'CLAUDE.local.md');
    if (await this.shouldWriteFile(claudeLocalPath)) {
      const claudeLocal = `# Local Development Configuration

## Environment

\`\`\`bash
# Development settings
CLAUDE_FLOW_LOG_LEVEL=debug
\`\`\`

## Personal Preferences

[Add your preferences here]

## Debug Settings

Enable verbose logging for development.

---

*This file is gitignored and contains local-only settings.*
`;
      await fs.writeFile(claudeLocalPath, claudeLocal, 'utf-8');
      files.push('CLAUDE.local.md');
    }

    // Update .gitignore for CLAUDE.local.md
    const gitignorePath = path.join(this.projectPath, '.gitignore');
    if (await fs.pathExists(gitignorePath)) {
      let content = await fs.readFile(gitignorePath, 'utf-8');
      if (!content.includes('CLAUDE.local.md')) {
        content += '\n# Claude Code local config\nCLAUDE.local.md\n';
        await fs.writeFile(gitignorePath, content, 'utf-8');
      }
    }

    warnings.push('Generated dual-platform setup. AGENTS.md is the canonical source.');

    return { files, warnings };
  }

  /**
   * Get the list of files that would be created (dry-run)
   */
  async dryRun(options: CodexInitOptions): Promise<string[]> {
    const files: string[] = [
      'AGENTS.md',
      '.agents/config.toml',
      '.agents/README.md',
      '.codex/AGENTS.override.md',
      '.codex/config.toml',
      '.gitignore (updated)',
    ];

    const skills = options.skills ?? DEFAULT_SKILLS_BY_TEMPLATE[options.template ?? 'default'];
    for (const skill of skills) {
      files.push(`.agents/skills/${skill}/SKILL.md`);
    }

    if (options.dual) {
      files.push('CLAUDE.md');
      files.push('CLAUDE.local.md');
    }

    return files;
  }
}

/**
 * Quick initialization function for programmatic use
 */
export async function initializeCodexProject(
  projectPath: string,
  options?: Partial<CodexInitOptions>
): Promise<CodexInitResult> {
  const initializer = new CodexInitializer();
  const initOptions: CodexInitOptions = {
    projectPath,
    template: options?.template ?? 'default',
    force: options?.force ?? false,
    dual: options?.dual ?? false,
  };
  if (options?.skills) {
    initOptions.skills = options.skills;
  }
  return initializer.initialize(initOptions);
}
