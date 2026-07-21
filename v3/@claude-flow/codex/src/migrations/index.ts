/**
 * @claude-flow/codex - Migrations
 *
 * Migration utilities for converting Claude Code configurations to Codex format
 * Supports full CLAUDE.md parsing with section extraction, skill conversion,
 * and proper AGENTS.md/config.toml generation.
 */

import type {
  MigrationOptions,
  MigrationResult,
  FeatureMapping,
  AgentsMdOptions,
  ConfigTomlOptions,
  McpServerConfig,
  ApprovalPolicy,
  SandboxMode,
} from '../types.js';
import { getRufloMcpServerConfig, renderMcpServerToml } from '../mcp-config.js';

/**
 * Parsed CLAUDE.md structure
 */
export interface ParsedClaudeMd {
  title: string;
  sections: ParsedSection[];
  skills: SkillReference[];
  hooks: string[];
  customInstructions: string[];
  codeBlocks: CodeBlock[];
  mcpServers: McpServerConfig[];
  settings: ParsedSettings;
  warnings: string[];
}

/**
 * Parsed section from markdown
 */
export interface ParsedSection {
  level: number;
  title: string;
  content: string;
  startLine: number;
  endLine: number;
}

/**
 * Skill reference found in content
 */
export interface SkillReference {
  name: string;
  syntax: 'slash' | 'dollar';
  context: string;
  line: number;
}

/**
 * Code block from markdown
 */
export interface CodeBlock {
  language: string;
  content: string;
  line: number;
}

function isRufloMcpServer(name: string, args: string[] | undefined): boolean {
  if (name === 'ruflo' || name === 'claude-flow' || name === 'claude_flow') {
    return true;
  }

  const commandLine = (args ?? []).join(' ');
  return /(?:^|\s)(?:ruflo|claude-flow)(?:@[^\s]+)?\s+mcp\s+start(?:\s|$)/.test(commandLine);
}

/**
 * Parsed settings from CLAUDE.md content
 */
export interface ParsedSettings {
  model?: string;
  approvalPolicy?: ApprovalPolicy;
  sandboxMode?: SandboxMode;
  projectName?: string;
  techStack?: string;
  buildCommand?: string;
  testCommand?: string;
  devCommand?: string;
}

/**
 * Feature mappings between Claude Code and Codex
 */
export const FEATURE_MAPPINGS: FeatureMapping[] = [
  {
    claudeCode: 'CLAUDE.md',
    codex: 'AGENTS.md',
    status: 'mapped',
    notes: 'Main instruction file - content is portable',
  },
  {
    claudeCode: 'CLAUDE.local.md',
    codex: '.codex/AGENTS.override.md',
    status: 'mapped',
    notes: 'Local overrides - gitignored in both',
  },
  {
    claudeCode: 'settings.json',
    codex: 'config.toml',
    status: 'mapped',
    notes: 'Format conversion required (JSON to TOML)',
  },
  {
    claudeCode: '/skill-name',
    codex: '$skill-name',
    status: 'mapped',
    notes: 'Skill invocation syntax - search and replace',
  },
  {
    claudeCode: 'TodoWrite',
    codex: 'Task tracking',
    status: 'mapped',
    notes: 'Similar functionality with different API',
  },
  {
    claudeCode: 'Task tool agents',
    codex: 'Sub-agent collaboration',
    status: 'partial',
    notes: 'Codex sub-agents via CODEX_HANDOFF_TARGET env var',
  },
  {
    claudeCode: 'MCP servers',
    codex: '[mcp_servers]',
    status: 'mapped',
    notes: 'Configuration format differs but same functionality',
  },
  {
    claudeCode: 'hooks system',
    codex: 'Automations',
    status: 'partial',
    notes: 'Codex automations are scheduled, not event-driven',
  },
  {
    claudeCode: 'EnterPlanMode',
    codex: 'No direct equivalent',
    status: 'unsupported',
    notes: 'Codex uses different planning paradigm',
  },
  {
    claudeCode: 'Permission modes',
    codex: 'approval_policy + sandbox_mode',
    status: 'mapped',
    notes: 'Codex provides more granular control',
  },
];

/**
 * Hook keywords recognized in CLAUDE.md
 */
const HOOK_KEYWORDS = [
  'pre-task',
  'post-task',
  'pre-edit',
  'post-edit',
  'pre-command',
  'post-command',
  'session-start',
  'session-end',
  'session-restore',
  'route',
  'explain',
  'pretrain',
  'notify',
];

/**
 * Patterns that need migration warnings
 */
const WARNING_PATTERNS: Array<{ pattern: RegExp | string; message: string }> = [
  { pattern: 'EnterPlanMode', message: 'EnterPlanMode has no direct Codex equivalent - review planning workflow' },
  { pattern: 'claude -p', message: 'claude -p headless mode - use Codex sub-agent patterns instead' },
  { pattern: 'TodoWrite', message: 'TodoWrite - Codex uses different task tracking approach' },
  { pattern: /--dangerously-skip-permissions/g, message: 'Dangerous permission skip detected - use Codex approval_policy instead' },
  { pattern: /mcp__claude-flow__/g, message: 'MCP tool calls need migration to Codex MCP configuration' },
  { pattern: /mcp__ruv-swarm__/g, message: 'Swarm MCP calls - ensure ruv-swarm MCP server is configured in config.toml' },
];

/**
 * Parse a CLAUDE.md file completely
 */
export async function parseClaudeMd(content: string): Promise<ParsedClaudeMd> {
  const lines = content.split('\n');
  const result: ParsedClaudeMd = {
    title: '',
    sections: [],
    skills: [],
    hooks: [],
    customInstructions: [],
    codeBlocks: [],
    mcpServers: [],
    settings: {},
    warnings: [],
  };

  // Extract title (first H1)
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch && titleMatch[1]) {
    result.title = titleMatch[1].trim();
    result.settings.projectName = result.title;
  }

  // Parse sections
  result.sections = parseSections(content, lines);

  // Extract skills (both /skill-name and $skill-name syntax)
  result.skills = extractSkills(content, lines);

  // Extract hooks
  result.hooks = extractHooks(content);

  // Extract code blocks
  result.codeBlocks = extractCodeBlocks(content, lines);

  // Extract MCP server configurations from code blocks
  result.mcpServers = extractMcpServers(result.codeBlocks);

  // Extract settings from content
  result.settings = {
    ...result.settings,
    ...extractSettings(content, result.sections),
  };

  // Extract custom instructions (behavioral rules)
  result.customInstructions = extractBehavioralRules(content);

  // Check for patterns that need warnings
  for (const { pattern, message } of WARNING_PATTERNS) {
    if (typeof pattern === 'string') {
      if (content.includes(pattern)) {
        result.warnings.push(message);
      }
    } else {
      if (pattern.test(content)) {
        result.warnings.push(message);
      }
    }
  }

  return result;
}

/**
 * Parse sections from markdown content
 */
function parseSections(content: string, lines: string[]): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const sectionRegex = /^(#{1,6})\s+(.+)$/;

  let currentSection: ParsedSection | null = null;
  let contentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = sectionRegex.exec(line);

    if (match && match[1] && match[2]) {
      // Save previous section
      if (currentSection) {
        currentSection.content = contentLines.join('\n').trim();
        currentSection.endLine = i;
        sections.push(currentSection);
      }

      // Start new section
      currentSection = {
        level: match[1].length,
        title: match[2].trim(),
        content: '',
        startLine: i + 1,
        endLine: i + 1,
      };
      contentLines = [];
    } else if (currentSection) {
      contentLines.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    currentSection.content = contentLines.join('\n').trim();
    currentSection.endLine = lines.length;
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Extract skill references from content
 */
function extractSkills(content: string, lines: string[]): SkillReference[] {
  const skills: SkillReference[] = [];
  const seenSkills = new Set<string>();

  // Slash syntax: /skill-name
  const slashRegex = /\/([a-z][a-z0-9-]*)/g;
  let match;

  while ((match = slashRegex.exec(content)) !== null) {
    const name = match[1]!;
    // Skip common false positives
    if (['src', 'dist', 'docs', 'tests', 'config', 'scripts', 'examples', 'node_modules', 'workspaces'].includes(name)) {
      continue;
    }
    if (!seenSkills.has(`slash:${name}`)) {
      seenSkills.add(`slash:${name}`);
      const lineNum = findLineNumber(content, match.index);
      skills.push({
        name,
        syntax: 'slash',
        context: getContextAroundMatch(lines, lineNum),
        line: lineNum,
      });
    }
  }

  // Dollar syntax: $skill-name
  const dollarRegex = /\$([a-z][a-z0-9-]+)/g;
  while ((match = dollarRegex.exec(content)) !== null) {
    const name = match[1]!;
    if (!seenSkills.has(`dollar:${name}`)) {
      seenSkills.add(`dollar:${name}`);
      const lineNum = findLineNumber(content, match.index);
      skills.push({
        name,
        syntax: 'dollar',
        context: getContextAroundMatch(lines, lineNum),
        line: lineNum,
      });
    }
  }

  return skills;
}

/**
 * Extract hooks referenced in content
 */
function extractHooks(content: string): string[] {
  const hooks: string[] = [];
  const lowerContent = content.toLowerCase();

  for (const hook of HOOK_KEYWORDS) {
    if (lowerContent.includes(hook)) {
      hooks.push(hook);
    }
  }

  return hooks;
}

/**
 * Extract code blocks from markdown
 */
function extractCodeBlocks(content: string, lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      content: match[2]!.trim(),
      line: findLineNumber(content, match.index),
    });
  }

  return blocks;
}

/**
 * Extract MCP server configurations from code blocks
 */
function extractMcpServers(codeBlocks: CodeBlock[]): McpServerConfig[] {
  const servers: McpServerConfig[] = [];

  for (const block of codeBlocks) {
    // Look for MCP server configurations in bash/shell blocks
    if (['bash', 'shell', 'sh', 'zsh'].includes(block.language)) {
      // Pattern: claude mcp add <name> <command> [args...]
      const mcpAddRegex = /claude\s+mcp\s+add\s+(\S+)\s+(.+)/g;
      let match;
      while ((match = mcpAddRegex.exec(block.content)) !== null) {
        const name = match[1]!;
        const parts = match[2]!.trim().split(/\s+/);
        servers.push({
          name,
          command: parts[0] || 'npx',
          args: parts.slice(1),
          enabled: true,
        });
      }
    }

    // Look for JSON MCP configurations
    if (['json', 'jsonc'].includes(block.language)) {
      try {
        const parsed = JSON.parse(block.content);
        if (parsed.mcpServers) {
          for (const [name, config] of Object.entries(parsed.mcpServers as Record<string, unknown>)) {
            const mcpConfig = config as { command?: string; args?: string[] };
            servers.push({
              name,
              command: mcpConfig.command || 'npx',
              args: mcpConfig.args || [],
              enabled: true,
            });
          }
        }
      } catch {
        // Not valid JSON, skip
      }
    }

    // Look for JavaScript/TypeScript MCP tool calls
    if (['javascript', 'typescript', 'js', 'ts'].includes(block.language)) {
      // Pattern: mcp__<server>__<tool>
      const mcpCallRegex = /mcp__([a-z-]+)__/g;
      const seenServers = new Set<string>();
      let match;
      while ((match = mcpCallRegex.exec(block.content)) !== null) {
        const serverName = match[1]!.replace(/-/g, '_');
        if (!seenServers.has(serverName)) {
          seenServers.add(serverName);
          // Don't add as full config, just note it exists
        }
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return servers.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

/**
 * Extract settings from content and sections
 */
function extractSettings(content: string, sections: ParsedSection[]): ParsedSettings {
  const settings: ParsedSettings = {};

  // Look for tech stack
  const techMatch = content.match(/(?:Tech\s*Stack|Technology|Stack)[:\s]+([^\n]+)/i);
  if (techMatch && techMatch[1]) {
    settings.techStack = techMatch[1].replace(/\*\*/g, '').trim();
  }

  // Look for build command
  const buildMatch = content.match(/(?:Build|Compile)[:\s]*\n?```(?:bash|sh)?\n([^\n]+)/i);
  if (buildMatch && buildMatch[1]) {
    settings.buildCommand = buildMatch[1].trim();
  } else {
    // Check for npm run build pattern
    if (content.includes('npm run build')) {
      settings.buildCommand = 'npm run build';
    }
  }

  // Look for test command
  const testMatch = content.match(/(?:Test)[:\s]*\n?```(?:bash|sh)?\n([^\n]+)/i);
  if (testMatch && testMatch[1]) {
    settings.testCommand = testMatch[1].trim();
  } else {
    if (content.includes('npm test')) {
      settings.testCommand = 'npm test';
    }
  }

  // Look for dev command
  if (content.includes('npm run dev')) {
    settings.devCommand = 'npm run dev';
  }

  // Look for approval/permission settings
  if (content.includes('auto-approve') || content.includes('autoApprove')) {
    settings.approvalPolicy = 'never';
  } else if (content.includes('read-only')) {
    settings.sandboxMode = 'read-only';
  }

  // Look for model specification
  const modelMatch = content.match(/model[:\s]+["']?([^"'\n]+)["']?/i);
  if (modelMatch && modelMatch[1]) {
    settings.model = modelMatch[1].trim();
  }

  return settings;
}

/**
 * Extract behavioral rules from content
 */
function extractBehavioralRules(content: string): string[] {
  const rules: string[] = [];

  // Look for Behavioral Rules section
  const behavioralMatch = content.match(/##\s*Behavioral\s*Rules[^\n]*\n([\s\S]*?)(?=\n##|\n#\s|$)/i);
  if (behavioralMatch && behavioralMatch[1]) {
    const ruleLines = behavioralMatch[1].split('\n');
    for (const line of ruleLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        rules.push(trimmed.substring(2));
      } else if (trimmed.startsWith('* ')) {
        rules.push(trimmed.substring(2));
      }
    }
  }

  // Also look for Security Rules
  const securityMatch = content.match(/##\s*Security\s*Rules?[^\n]*\n([\s\S]*?)(?=\n##|\n#\s|$)/i);
  if (securityMatch && securityMatch[1]) {
    const securityLines = securityMatch[1].split('\n');
    for (const line of securityLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        rules.push(trimmed.substring(2));
      } else if (trimmed.startsWith('* ')) {
        rules.push(trimmed.substring(2));
      }
    }
  }

  return rules;
}

/**
 * Find line number for a character index
 */
function findLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

/**
 * Get context around a match
 */
function getContextAroundMatch(lines: string[], lineNum: number): string {
  const start = Math.max(0, lineNum - 2);
  const end = Math.min(lines.length, lineNum + 1);
  return lines.slice(start, end).join('\n');
}

/**
 * Analyze a CLAUDE.md file for migration (simplified interface)
 */
export async function analyzeClaudeMd(content: string): Promise<{
  sections: string[];
  skills: string[];
  hooks: string[];
  customInstructions: string[];
  warnings: string[];
}> {
  const parsed = await parseClaudeMd(content);

  return {
    sections: parsed.sections.map((s) => s.title),
    skills: [...new Set(parsed.skills.map((s) => s.name))],
    hooks: parsed.hooks,
    customInstructions: parsed.customInstructions,
    warnings: parsed.warnings,
  };
}

/**
 * Convert skill invocation syntax from slash to dollar
 */
export function convertSkillSyntax(content: string): string {
  // Convert /skill-name to $skill-name, but avoid path-like patterns
  return content.replace(/(?<![a-zA-Z0-9_./])\/([a-z][a-z0-9-]*)(?![a-zA-Z0-9_./])/g, (match, skillName) => {
    // Skip common directory names
    const skipPatterns = ['src', 'dist', 'docs', 'tests', 'config', 'scripts', 'examples', 'node_modules', 'workspaces', 'data', 'logs', 'tmp', 'var', 'etc', 'usr', 'bin', 'lib'];
    if (skipPatterns.includes(skillName)) {
      return match;
    }
    return `$${skillName}`;
  });
}

/**
 * Generate AGENTS.md content from parsed CLAUDE.md
 */
export function generateAgentsMdFromParsed(parsed: ParsedClaudeMd): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${parsed.title || 'Project Agent Guide'}`);
  lines.push('');
  lines.push('> Migrated from CLAUDE.md by @claude-flow/codex');
  lines.push('');

  // Project Overview
  lines.push('## Project Overview');
  lines.push('');
  if (parsed.settings.techStack) {
    lines.push(`**Tech Stack**: ${parsed.settings.techStack}`);
  }
  lines.push('');

  // Quick Start
  lines.push('## Setup');
  lines.push('');
  if (parsed.settings.buildCommand) {
    lines.push('### Build');
    lines.push('```bash');
    lines.push(parsed.settings.buildCommand);
    lines.push('```');
    lines.push('');
  }
  if (parsed.settings.testCommand) {
    lines.push('### Test');
    lines.push('```bash');
    lines.push(parsed.settings.testCommand);
    lines.push('```');
    lines.push('');
  }
  if (parsed.settings.devCommand) {
    lines.push('### Development');
    lines.push('```bash');
    lines.push(parsed.settings.devCommand);
    lines.push('```');
    lines.push('');
  }

  // Code Standards
  lines.push('## Code Standards');
  lines.push('');
  lines.push('- Files under 500 lines');
  lines.push('- No hardcoded secrets');
  lines.push('- Input validation at boundaries');
  lines.push('- Typed interfaces for public APIs');
  lines.push('');

  // Skills
  if (parsed.skills.length > 0) {
    lines.push('## Skills');
    lines.push('');
    lines.push('| Skill | Original Syntax |');
    lines.push('|-------|-----------------|');
    for (const skill of parsed.skills) {
      const codexSyntax = `$${skill.name}`;
      const originalSyntax = skill.syntax === 'slash' ? `/${skill.name}` : `$${skill.name}`;
      lines.push(`| \`${codexSyntax}\` | \`${originalSyntax}\` |`);
    }
    lines.push('');
  }

  // Security
  lines.push('## Security');
  lines.push('');
  if (parsed.customInstructions.length > 0) {
    for (const rule of parsed.customInstructions.slice(0, 10)) {
      lines.push(`- ${rule}`);
    }
  } else {
    lines.push('- NEVER commit secrets or credentials');
    lines.push('- Validate all user inputs');
    lines.push('- Prevent directory traversal attacks');
  }
  lines.push('');

  // Hooks (as reference)
  if (parsed.hooks.length > 0) {
    lines.push('## Automation Hooks');
    lines.push('');
    lines.push('The following hooks were detected in the original configuration:');
    lines.push('');
    for (const hook of parsed.hooks) {
      lines.push(`- \`${hook}\``);
    }
    lines.push('');
    lines.push('> Note: Codex uses scheduled Automations instead of event-driven hooks.');
    lines.push('');
  }

  // MCP Servers
  if (parsed.mcpServers.length > 0) {
    lines.push('## MCP Servers');
    lines.push('');
    lines.push('Configure in config.toml:');
    lines.push('');
    for (const server of parsed.mcpServers) {
      lines.push(`- **${server.name}**: \`${server.command} ${(server.args || []).join(' ')}\``);
    }
    lines.push('');
  }

  // Migration notes
  if (parsed.warnings.length > 0) {
    lines.push('## Migration Notes');
    lines.push('');
    for (const warning of parsed.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Convert settings.json to config.toml format
 */
export function convertSettingsToToml(
  settings: Record<string, unknown>,
  platform: NodeJS.Platform = process.platform,
): string {
  const lines: string[] = [];
  lines.push('# Migrated from settings.json');
  lines.push('# Generated by @claude-flow/codex');
  lines.push('');

  // Model
  if (settings.model) {
    lines.push(`model = "${settings.model}"`);
  } else {
    lines.push('model = "gpt-5.3-codex"');
  }
  lines.push('');

  // Permissions mapping
  if (settings.permissions) {
    const perms = settings.permissions as Record<string, unknown>;
    if (perms.autoApprove === true) {
      lines.push('approval_policy = "never"');
      lines.push('sandbox_mode = "danger-full-access"');
    } else if (perms.autoApprove === 'read-only') {
      lines.push('approval_policy = "on-request"');
      lines.push('sandbox_mode = "read-only"');
    } else {
      lines.push('approval_policy = "on-request"');
      lines.push('sandbox_mode = "workspace-write"');
    }
  } else {
    lines.push('approval_policy = "on-request"');
    lines.push('sandbox_mode = "workspace-write"');
  }
  lines.push('');

  // Web search
  if (settings.webSearch !== undefined) {
    const mode = settings.webSearch === true ? 'live' : settings.webSearch === false ? 'disabled' : 'cached';
    lines.push(`web_search = "${mode}"`);
  } else {
    lines.push('web_search = "cached"');
  }
  lines.push('');

  // Features
  lines.push('[features]');
  lines.push('child_agents_md = true');
  lines.push('shell_snapshot = true');
  lines.push('request_rule = true');
  lines.push('');

  // MCP servers
  let hasRuflo = false;
  if (settings.mcpServers && typeof settings.mcpServers === 'object') {
    for (const [name, config] of Object.entries(settings.mcpServers as Record<string, unknown>)) {
      const mcpConfig = config as { command?: string; args?: string[]; env?: Record<string, string> };
      if (isRufloMcpServer(name, mcpConfig.args)) {
        if (!hasRuflo) {
          lines.push(...renderMcpServerToml({
            ...getRufloMcpServerConfig(platform),
            ...(mcpConfig.env ? { env: mcpConfig.env } : {}),
          }));
          lines.push('');
          hasRuflo = true;
        }
        continue;
      }

      lines.push(...renderMcpServerToml({
        name,
        command: mcpConfig.command || 'npx',
        enabled: true,
        ...(mcpConfig.args ? { args: mcpConfig.args } : {}),
        ...(mcpConfig.env ? { env: mcpConfig.env } : {}),
      }));
      lines.push('');
    }
  }

  if (!hasRuflo) {
    lines.push(...renderMcpServerToml(getRufloMcpServerConfig(platform)));
    lines.push('');
  }

  // History
  lines.push('[history]');
  lines.push('persistence = "save-all"');
  lines.push('');

  // Profiles
  lines.push('# Development profile');
  lines.push('[profiles.dev]');
  lines.push('approval_policy = "never"');
  lines.push('sandbox_mode = "danger-full-access"');
  lines.push('');

  lines.push('# Safe profile');
  lines.push('[profiles.safe]');
  lines.push('approval_policy = "untrusted"');
  lines.push('sandbox_mode = "read-only"');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate config.toml from parsed CLAUDE.md
 */
export function generateConfigTomlFromParsed(
  parsed: ParsedClaudeMd,
  platform: NodeJS.Platform = process.platform,
): string {
  const lines: string[] = [];
  lines.push('# Migrated from CLAUDE.md');
  lines.push('# Generated by @claude-flow/codex');
  lines.push('');

  // Model
  lines.push(`model = "${parsed.settings.model || 'gpt-5.3-codex'}"`);
  lines.push('');

  // Approval policy
  const approvalPolicy = parsed.settings.approvalPolicy || 'on-request';
  lines.push(`approval_policy = "${approvalPolicy}"`);
  lines.push('');

  // Sandbox mode
  const sandboxMode = parsed.settings.sandboxMode || 'workspace-write';
  lines.push(`sandbox_mode = "${sandboxMode}"`);
  lines.push('');

  // Web search
  lines.push('web_search = "cached"');
  lines.push('');

  // Features
  lines.push('[features]');
  lines.push('child_agents_md = true');
  lines.push('shell_snapshot = true');
  lines.push('request_rule = true');
  lines.push('');

  // MCP servers
  let hasRuflo = false;
  for (const server of parsed.mcpServers) {
    if (isRufloMcpServer(server.name, server.args)) {
      if (!hasRuflo) {
        lines.push(...renderMcpServerToml(getRufloMcpServerConfig(platform)));
        lines.push('');
        hasRuflo = true;
      }
    } else {
      lines.push(...renderMcpServerToml({
        ...server,
        name: server.name.replace(/-/g, '_'),
      }));
      lines.push('');
    }
  }

  if (!hasRuflo) {
    lines.push(...renderMcpServerToml(getRufloMcpServerConfig(platform)));
    lines.push('');
  }

  // Skills
  if (parsed.skills.length > 0) {
    lines.push('# Skills detected in original configuration');
    for (const skill of parsed.skills) {
      lines.push(`# - ${skill.name} (${skill.syntax} syntax)`);
    }
    lines.push('');
  }

  // History
  lines.push('[history]');
  lines.push('persistence = "save-all"');
  lines.push('');

  // Profiles
  lines.push('[profiles.dev]');
  lines.push('approval_policy = "never"');
  lines.push('sandbox_mode = "danger-full-access"');
  lines.push('');

  lines.push('[profiles.safe]');
  lines.push('approval_policy = "untrusted"');
  lines.push('sandbox_mode = "read-only"');
  lines.push('');

  return lines.join('\n');
}

/**
 * Migrate from Claude Code (CLAUDE.md) to Codex (AGENTS.md)
 */
export async function migrateFromClaudeCode(options: MigrationOptions): Promise<MigrationResult> {
  const { sourcePath, targetPath, preserveComments = true, generateSkills = true } = options;

  try {
    // In actual implementation, this would read the file
    // For now, we provide the structure for the migration

    const result: MigrationResult = {
      success: true,
      agentsMdPath: `${targetPath}/AGENTS.md`,
      skillsCreated: generateSkills
        ? ['swarm-orchestration', 'memory-management', 'security-audit']
        : [],
      configTomlPath: `${targetPath}/.agents/config.toml`,
      mappings: FEATURE_MAPPINGS,
      warnings: [
        'Review skill invocation syntax (changed from / to $)',
        'Check hook configurations for Automation compatibility',
        'Verify MCP server configurations in config.toml',
      ],
    };

    return result;
  } catch (error) {
    return {
      success: false,
      warnings: [`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }
}

/**
 * Perform full migration with content
 */
export async function performFullMigration(
  claudeMdContent: string,
  settingsJson?: Record<string, unknown>
): Promise<{
  agentsMd: string;
  configToml: string;
  warnings: string[];
  skillsToCreate: string[];
}> {
  // Parse CLAUDE.md
  const parsed = await parseClaudeMd(claudeMdContent);

  // Generate AGENTS.md
  let agentsMd = generateAgentsMdFromParsed(parsed);

  // Convert skill syntax in the generated content
  agentsMd = convertSkillSyntax(agentsMd);

  // Generate config.toml
  let configToml: string;
  if (settingsJson) {
    configToml = convertSettingsToToml(settingsJson);
  } else {
    configToml = generateConfigTomlFromParsed(parsed);
  }

  // Collect skills to create
  const skillsToCreate = [...new Set(parsed.skills.map((s) => s.name))];

  return {
    agentsMd,
    configToml,
    warnings: parsed.warnings,
    skillsToCreate,
  };
}

/**
 * Generate migration report
 */
export function generateMigrationReport(result: MigrationResult): string {
  const lines: string[] = [];

  lines.push('# Migration Report');
  lines.push('');
  lines.push(`**Status**: ${result.success ? 'Success' : 'Failed'}`);
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push('');

  if (result.agentsMdPath) {
    lines.push('## Generated Files');
    lines.push('');
    lines.push(`- AGENTS.md: \`${result.agentsMdPath}\``);
    if (result.configTomlPath) {
      lines.push(`- config.toml: \`${result.configTomlPath}\``);
    }
    lines.push('');
  }

  if (result.skillsCreated && result.skillsCreated.length > 0) {
    lines.push('## Skills Created');
    lines.push('');
    for (const skill of result.skillsCreated) {
      lines.push(`- \`$${skill}\``);
    }
    lines.push('');
  }

  if (result.mappings) {
    lines.push('## Feature Mappings');
    lines.push('');
    lines.push('| Claude Code | Codex | Status | Notes |');
    lines.push('|-------------|-------|--------|-------|');
    for (const mapping of result.mappings) {
      const notes = mapping.notes || '';
      lines.push(`| \`${mapping.claudeCode}\` | \`${mapping.codex}\` | ${mapping.status} | ${notes} |`);
    }
    lines.push('');
  }

  if (result.warnings && result.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  lines.push('## Next Steps');
  lines.push('');
  lines.push('1. Review generated AGENTS.md for accuracy');
  lines.push('2. Update skill references from `/skill-name` to `$skill-name`');
  lines.push('3. Configure MCP servers in config.toml');
  lines.push('4. Create skill definitions in `.agents/skills/`');
  lines.push('5. Test with `codex` CLI');
  lines.push('');

  return lines.join('\n');
}
