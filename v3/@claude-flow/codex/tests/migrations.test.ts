/**
 * @claude-flow/codex - Migration Tests
 *
 * Tests for Claude Code to Codex migration functions
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeClaudeMd,
  migrateFromClaudeCode,
  convertSkillSyntax,
  convertSettingsToToml,
  generateMigrationReport,
  FEATURE_MAPPINGS,
} from '../src/migrations/index.js';
import type { MigrationResult } from '../src/types.js';

// =============================================================================
// Sample CLAUDE.md Content for Testing
// =============================================================================

const SAMPLE_CLAUDE_MD = `# Claude Flow V3 Project

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files

## File Organization

- Use \`/src\` for source code files
- Use \`/tests\` for test files
- Use \`/docs\` for documentation

## Swarm Orchestration

Use /swarm-init to initialize the swarm.
Run /security-scan for security checks.

The /memory-store command stores patterns.

## Hooks

Use pre-task hooks before starting work.
Use post-task hooks after completion.
The session-start hook initializes context.

## Advanced

Run \`claude -p "analyze code"\` for headless analysis.
Use TodoWrite for task tracking.
EnterPlanMode for planning complex tasks.
`;

const SAMPLE_CLAUDE_MD_WITH_SKILLS = `# Skill Project

## Skills

- /code-review - Review code changes
- /test-generation - Generate tests
- /performance-analysis - Analyze performance
- /security-audit - Security checks

## Commands

Run /deploy for deployment.
Use /rollback if needed.
`;

// =============================================================================
// analyzeClaudeMd Tests
// =============================================================================

describe('analyzeClaudeMd', () => {
  describe('section extraction', () => {
    it('should extract all level-2 sections', async () => {
      const result = await analyzeClaudeMd(SAMPLE_CLAUDE_MD);

      expect(result.sections).toContain('Behavioral Rules (Always Enforced)');
      expect(result.sections).toContain('File Organization');
      expect(result.sections).toContain('Swarm Orchestration');
      expect(result.sections).toContain('Hooks');
      expect(result.sections).toContain('Advanced');
    });

    it('should handle CLAUDE.md with no level-2 sections', async () => {
      const content = `# Simple Project

Just a description with no level-2 sections.
`;

      const result = await analyzeClaudeMd(content);

      // The sections array should be empty or not contain level-2 section titles
      // Since there are no ## headings, we should have no sections or only the H1
      expect(result.sections.length).toBeLessThanOrEqual(1);
    });
  });

  describe('skill extraction', () => {
    it('should extract skill references', async () => {
      const result = await analyzeClaudeMd(SAMPLE_CLAUDE_MD);

      expect(result.skills).toContain('swarm-init');
      expect(result.skills).toContain('security-scan');
      expect(result.skills).toContain('memory-store');
    });

    it('should extract multiple skills without duplicates', async () => {
      const content = `# Project

Use /skill-a and /skill-b.
Also run /skill-a again.
Then /skill-c.
`;

      const result = await analyzeClaudeMd(content);

      expect(result.skills).toContain('skill-a');
      expect(result.skills).toContain('skill-b');
      expect(result.skills).toContain('skill-c');
      expect(result.skills.filter(s => s === 'skill-a')).toHaveLength(1);
    });

    it('should extract skills from skill-heavy document', async () => {
      const result = await analyzeClaudeMd(SAMPLE_CLAUDE_MD_WITH_SKILLS);

      expect(result.skills).toContain('code-review');
      expect(result.skills).toContain('test-generation');
      expect(result.skills).toContain('performance-analysis');
      expect(result.skills).toContain('security-audit');
      expect(result.skills).toContain('deploy');
      expect(result.skills).toContain('rollback');
    });
  });

  describe('hook extraction', () => {
    it('should detect referenced hooks', async () => {
      const result = await analyzeClaudeMd(SAMPLE_CLAUDE_MD);

      expect(result.hooks).toContain('pre-task');
      expect(result.hooks).toContain('post-task');
      expect(result.hooks).toContain('session-start');
    });

    it('should handle document with no hooks', async () => {
      const content = `# No Hooks Project

Just a simple project with no hook references.
`;

      const result = await analyzeClaudeMd(content);

      expect(result.hooks).toHaveLength(0);
    });

    it('should detect all hook types', async () => {
      const content = `# All Hooks

Use pre-task before work.
Use post-task after work.
Use pre-edit before editing.
Use post-edit after editing.
Use session-start at startup.
Use session-end at shutdown.
`;

      const result = await analyzeClaudeMd(content);

      expect(result.hooks).toContain('pre-task');
      expect(result.hooks).toContain('post-task');
      expect(result.hooks).toContain('pre-edit');
      expect(result.hooks).toContain('post-edit');
      expect(result.hooks).toContain('session-start');
      expect(result.hooks).toContain('session-end');
    });
  });

  describe('custom instructions extraction', () => {
    it('should extract behavioral rules', async () => {
      const result = await analyzeClaudeMd(SAMPLE_CLAUDE_MD);

      expect(result.customInstructions).toContain(
        'Do what has been asked; nothing more, nothing less'
      );
      expect(result.customInstructions).toContain(
        'NEVER create files unless they\'re absolutely necessary'
      );
    });

    it('should handle document without Behavioral Rules section', async () => {
      const content = `# Simple Project

## Quick Start

npm install
`;

      const result = await analyzeClaudeMd(content);

      expect(result.customInstructions).toHaveLength(0);
    });
  });

  describe('warnings generation', () => {
    it('should warn about EnterPlanMode usage', async () => {
      const result = await analyzeClaudeMd(SAMPLE_CLAUDE_MD);

      expect(result.warnings.some(w => w.includes('EnterPlanMode'))).toBe(true);
    });

    it('should warn about claude -p usage', async () => {
      const result = await analyzeClaudeMd(SAMPLE_CLAUDE_MD);

      expect(result.warnings.some(w => w.includes('claude -p'))).toBe(true);
    });

    it('should warn about TodoWrite usage', async () => {
      const result = await analyzeClaudeMd(SAMPLE_CLAUDE_MD);

      expect(result.warnings.some(w => w.includes('TodoWrite'))).toBe(true);
    });

    it('should not generate warnings for clean CLAUDE.md', async () => {
      const content = `# Clean Project

## Setup

npm install

## Code Standards

- Keep files small
- Use typed interfaces
`;

      const result = await analyzeClaudeMd(content);

      expect(result.warnings).toHaveLength(0);
    });
  });
});

// =============================================================================
// migrateFromClaudeCode Tests
// =============================================================================

describe('migrateFromClaudeCode', () => {
  describe('successful migration', () => {
    it('should return success result', async () => {
      const result = await migrateFromClaudeCode({
        sourcePath: '/project/CLAUDE.md',
        targetPath: '/project',
      });

      expect(result.success).toBe(true);
    });

    it('should generate AGENTS.md path', async () => {
      const result = await migrateFromClaudeCode({
        sourcePath: '/project/CLAUDE.md',
        targetPath: '/project',
      });

      expect(result.agentsMdPath).toBe('/project/AGENTS.md');
    });

    it('should generate config.toml path', async () => {
      const result = await migrateFromClaudeCode({
        sourcePath: '/project/CLAUDE.md',
        targetPath: '/project',
      });

      expect(result.configTomlPath).toBe('/project/.agents/config.toml');
    });

    it('should create default skills when generateSkills is true', async () => {
      const result = await migrateFromClaudeCode({
        sourcePath: '/project/CLAUDE.md',
        targetPath: '/project',
        generateSkills: true,
      });

      expect(result.skillsCreated).toContain('swarm-orchestration');
      expect(result.skillsCreated).toContain('memory-management');
      expect(result.skillsCreated).toContain('security-audit');
    });

    it('should not create skills when generateSkills is false', async () => {
      const result = await migrateFromClaudeCode({
        sourcePath: '/project/CLAUDE.md',
        targetPath: '/project',
        generateSkills: false,
      });

      expect(result.skillsCreated).toHaveLength(0);
    });

    it('should include feature mappings', async () => {
      const result = await migrateFromClaudeCode({
        sourcePath: '/project/CLAUDE.md',
        targetPath: '/project',
      });

      expect(result.mappings).toBeDefined();
      expect(result.mappings!.length).toBeGreaterThan(0);
    });

    it('should include migration warnings', async () => {
      const result = await migrateFromClaudeCode({
        sourcePath: '/project/CLAUDE.md',
        targetPath: '/project',
      });

      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.includes('skill invocation syntax'))).toBe(true);
    });
  });

  describe('migration options', () => {
    it('should respect preserveComments option', async () => {
      const result = await migrateFromClaudeCode({
        sourcePath: '/project/CLAUDE.md',
        targetPath: '/project',
        preserveComments: true,
      });

      expect(result.success).toBe(true);
    });

    it('should use custom target path', async () => {
      const result = await migrateFromClaudeCode({
        sourcePath: '/old/CLAUDE.md',
        targetPath: '/new/project',
      });

      expect(result.agentsMdPath).toBe('/new/project/AGENTS.md');
      expect(result.configTomlPath).toBe('/new/project/.agents/config.toml');
    });
  });
});

// =============================================================================
// convertSkillSyntax Tests
// =============================================================================

describe('convertSkillSyntax', () => {
  it('should convert /skill-name to $skill-name', () => {
    const content = 'Use /swarm-init to start.';
    const result = convertSkillSyntax(content);

    expect(result).toBe('Use $swarm-init to start.');
  });

  it('should convert multiple skill references', () => {
    const content = 'Run /skill-a then /skill-b and finally /skill-c.';
    const result = convertSkillSyntax(content);

    expect(result).toBe('Run $skill-a then $skill-b and finally $skill-c.');
  });

  it('should preserve URLs (improved regex)', () => {
    const content = 'Visit https://example.com/path for more info.';
    const result = convertSkillSyntax(content);

    // The improved regex should not convert paths within URLs
    // as it excludes patterns preceded by alphanumeric/underscore/dot/slash chars
    expect(result).toBe(content);
  });

  it('should handle complex skill names', () => {
    const content = '/multi-word-skill-name and /a1b2c3';
    const result = convertSkillSyntax(content);

    expect(result).toBe('$multi-word-skill-name and $a1b2c3');
  });

  it('should preserve surrounding text', () => {
    const content = 'Before /skill after';
    const result = convertSkillSyntax(content);

    expect(result).toBe('Before $skill after');
  });

  it('should handle content with no skills', () => {
    const content = 'No skills here, just regular text.';
    const result = convertSkillSyntax(content);

    expect(result).toBe('No skills here, just regular text.');
  });

  it('should convert skills at line start', () => {
    const content = '/skill-at-start\nMore text';
    const result = convertSkillSyntax(content);

    expect(result).toBe('$skill-at-start\nMore text');
  });

  it('should convert skills at line end', () => {
    const content = 'Run the command /skill-at-end';
    const result = convertSkillSyntax(content);

    expect(result).toBe('Run the command $skill-at-end');
  });
});

// =============================================================================
// convertSettingsToToml Tests
// =============================================================================

describe('convertSettingsToToml', () => {
  it('should include migration header', () => {
    const result = convertSettingsToToml({});

    expect(result).toContain('# Migrated from settings.json');
  });

  it('should convert model setting', () => {
    const settings = {
      model: 'claude-3-opus',
    };

    const result = convertSettingsToToml(settings, 'linux');

    expect(result).toContain('model = "claude-3-opus"');
  });

  it('should convert autoApprove true to never policy', () => {
    const settings = {
      permissions: {
        autoApprove: true,
      },
    };

    const result = convertSettingsToToml(settings, 'linux');

    expect(result).toContain('approval_policy = "never"');
  });

  it('should convert autoApprove read-only', () => {
    const settings = {
      permissions: {
        autoApprove: 'read-only',
      },
    };

    const result = convertSettingsToToml(settings);

    expect(result).toContain('approval_policy = "on-request"');
    expect(result).toContain('sandbox_mode = "read-only"');
  });

  it('should use on-request as default approval policy', () => {
    const settings = {
      permissions: {
        autoApprove: false,
      },
    };

    const result = convertSettingsToToml(settings);

    expect(result).toContain('approval_policy = "on-request"');
  });

  it('should convert MCP servers', () => {
    const settings = {
      mcpServers: {
        'claude-flow': {
          command: 'npx',
          args: ['-y', '@claude-flow/cli'],
        },
        'custom-server': {
          command: 'node',
          args: ['./server.js', '--port', '3000'],
        },
      },
    };

    const result = convertSettingsToToml(settings, 'linux');

    expect(result).toContain('[mcp_servers.ruflo]');
    expect(result).toContain('args = ["-y", "ruflo@latest", "mcp", "start"]');
    expect(result).toContain('startup_timeout_sec = 120');
    expect(result).toContain('[mcp_servers.custom-server]');
    expect(result).toContain('command = "node"');
  });

  it('adds Ruflo alongside unrelated custom MCP servers', () => {
    const result = convertSettingsToToml({
      mcpServers: { custom: { command: 'node', args: ['server.js'] } },
    }, 'win32');

    expect(result).toContain('[mcp_servers.custom]');
    expect(result).toContain('[mcp_servers.ruflo]');
    expect(result).toContain('command = "cmd"');
    expect(result).toContain('args = ["/c", "npx", "-y", "ruflo@latest", "mcp", "start"]');
  });

  it('should add default ruflo server when no mcpServers', () => {
    const settings = {
      model: 'gpt-4',
    };

    const result = convertSettingsToToml(settings, 'linux');

    // The implementation adds a default ruflo server when none specified
    expect(result).toContain('[mcp_servers.ruflo]');
    expect(result).toContain('command = "npx"');
  });

  it('should handle empty settings', () => {
    const result = convertSettingsToToml({});

    expect(result).toContain('# Migrated from settings.json');
    expect(result.split('\n').length).toBeGreaterThan(1);
  });
});

// =============================================================================
// generateMigrationReport Tests
// =============================================================================

describe('generateMigrationReport', () => {
  describe('successful migration report', () => {
    it('should show success status', () => {
      const result: MigrationResult = {
        success: true,
        agentsMdPath: '/project/AGENTS.md',
        configTomlPath: '/project/.agents/config.toml',
        skillsCreated: ['swarm-orchestration', 'memory-management'],
        mappings: FEATURE_MAPPINGS,
        warnings: ['Check skill syntax'],
      };

      const report = generateMigrationReport(result);

      expect(report).toContain('# Migration Report');
      expect(report).toContain('**Status**: Success');
    });

    it('should list generated files', () => {
      const result: MigrationResult = {
        success: true,
        agentsMdPath: '/project/AGENTS.md',
        configTomlPath: '/project/.agents/config.toml',
      };

      const report = generateMigrationReport(result);

      expect(report).toContain('## Generated Files');
      expect(report).toContain('AGENTS.md:');
      expect(report).toContain('/project/AGENTS.md');
      expect(report).toContain('config.toml:');
      expect(report).toContain('/project/.agents/config.toml');
    });

    it('should list created skills', () => {
      const result: MigrationResult = {
        success: true,
        skillsCreated: ['skill-a', 'skill-b', 'skill-c'],
      };

      const report = generateMigrationReport(result);

      expect(report).toContain('## Skills Created');
      // Skills are formatted with $ prefix in backticks
      expect(report).toContain('$skill-a');
      expect(report).toContain('$skill-b');
      expect(report).toContain('$skill-c');
    });

    it('should include feature mappings table', () => {
      const result: MigrationResult = {
        success: true,
        mappings: [
          { claudeCode: 'CLAUDE.md', codex: 'AGENTS.md', status: 'mapped', notes: 'Main file' },
          { claudeCode: '/skill', codex: '$skill', status: 'mapped', notes: 'Syntax change' },
        ],
      };

      const report = generateMigrationReport(result);

      expect(report).toContain('## Feature Mappings');
      // Table now includes Notes column
      expect(report).toContain('| Claude Code | Codex | Status | Notes |');
      expect(report).toContain('CLAUDE.md');
      expect(report).toContain('AGENTS.md');
      expect(report).toContain('mapped');
    });

    it('should include warnings', () => {
      const result: MigrationResult = {
        success: true,
        warnings: ['Warning 1', 'Warning 2'],
      };

      const report = generateMigrationReport(result);

      expect(report).toContain('## Warnings');
      expect(report).toContain('- Warning 1');
      expect(report).toContain('- Warning 2');
    });
  });

  describe('failed migration report', () => {
    it('should show failed status', () => {
      const result: MigrationResult = {
        success: false,
        warnings: ['Migration failed: File not found'],
      };

      const report = generateMigrationReport(result);

      expect(report).toContain('**Status**: Failed');
    });

    it('should include error warnings', () => {
      const result: MigrationResult = {
        success: false,
        warnings: ['Error: Could not read source file'],
      };

      const report = generateMigrationReport(result);

      expect(report).toContain('## Warnings');
      expect(report).toContain('Error: Could not read source file');
    });
  });

  describe('minimal report', () => {
    it('should handle minimal result', () => {
      const result: MigrationResult = {
        success: true,
      };

      const report = generateMigrationReport(result);

      expect(report).toContain('# Migration Report');
      expect(report).toContain('**Status**: Success');
      expect(report).not.toContain('## Generated Files');
      expect(report).not.toContain('## Skills Created');
    });
  });
});

// =============================================================================
// FEATURE_MAPPINGS Tests
// =============================================================================

describe('FEATURE_MAPPINGS', () => {
  it('should contain CLAUDE.md to AGENTS.md mapping', () => {
    const mapping = FEATURE_MAPPINGS.find(m => m.claudeCode === 'CLAUDE.md');

    expect(mapping).toBeDefined();
    expect(mapping!.codex).toBe('AGENTS.md');
    expect(mapping!.status).toBe('mapped');
  });

  it('should contain skill invocation syntax mapping', () => {
    const mapping = FEATURE_MAPPINGS.find(m => m.claudeCode === '/skill-name');

    expect(mapping).toBeDefined();
    expect(mapping!.codex).toBe('$skill-name');
    expect(mapping!.status).toBe('mapped');
  });

  it('should contain MCP servers mapping', () => {
    const mapping = FEATURE_MAPPINGS.find(m => m.claudeCode === 'MCP servers');

    expect(mapping).toBeDefined();
    expect(mapping!.codex).toBe('[mcp_servers]');
    expect(mapping!.status).toBe('mapped');
  });

  it('should mark EnterPlanMode as unsupported', () => {
    const mapping = FEATURE_MAPPINGS.find(m => m.claudeCode === 'EnterPlanMode');

    expect(mapping).toBeDefined();
    expect(mapping!.status).toBe('unsupported');
  });

  it('should mark hooks as partial', () => {
    const mapping = FEATURE_MAPPINGS.find(m => m.claudeCode === 'hooks system');

    expect(mapping).toBeDefined();
    expect(mapping!.status).toBe('partial');
  });

  it('should include notes for all mappings', () => {
    for (const mapping of FEATURE_MAPPINGS) {
      expect(mapping.notes).toBeDefined();
      expect(mapping.notes!.length).toBeGreaterThan(0);
    }
  });

  it('should have at least 8 mappings', () => {
    expect(FEATURE_MAPPINGS.length).toBeGreaterThanOrEqual(8);
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('migration integration', () => {
  it('should analyze and migrate consistently', async () => {
    const content = `# Test Project

## Behavioral Rules

- Rule one
- Rule two

## Skills

Use /skill-a and /skill-b.

## Hooks

Use pre-task hooks.
`;

    const analysis = await analyzeClaudeMd(content);
    const migration = await migrateFromClaudeCode({
      sourcePath: '/test/CLAUDE.md',
      targetPath: '/test',
    });

    expect(analysis.skills).toContain('skill-a');
    expect(analysis.skills).toContain('skill-b');
    expect(analysis.hooks).toContain('pre-task');
    expect(migration.success).toBe(true);
  });

  it('should convert analyzed content correctly', async () => {
    const content = 'Use /swarm-orchestration and /memory-management.';
    const converted = convertSkillSyntax(content);
    const analysis = await analyzeClaudeMd(content);

    expect(converted).toContain('$swarm-orchestration');
    expect(converted).toContain('$memory-management');
    expect(analysis.skills).toContain('swarm-orchestration');
    expect(analysis.skills).toContain('memory-management');
  });
});
