/**
 * @claude-flow/codex - Generator Tests
 *
 * Tests for AGENTS.md, SKILL.md, and config.toml generators
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateAgentsMd,
  generateSkillMd,
  generateConfigToml,
} from '../src/generators/index.js';
import { generateBuiltInSkill } from '../src/generators/skill-md.js';
import {
  generateMinimalConfigToml,
  generateCIConfigToml,
} from '../src/generators/config-toml.js';
import type {
  AgentsMdOptions,
  SkillMdOptions,
  ConfigTomlOptions,
} from '../src/types.js';

// =============================================================================
// AGENTS.md Generator Tests
// =============================================================================

describe('generateAgentsMd', () => {
  describe('minimal template', () => {
    it('should generate a minimal AGENTS.md with required sections', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Test Project',
        template: 'minimal',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('# Test Project');
      expect(result).toContain('## Quick Start');
      expect(result).toContain('## Agent Behavior');
      expect(result).toContain('## Code Standards');
      expect(result).toContain('## Skills');
      expect(result).toContain('## Security Rules');
    });

    it('should include custom description', async () => {
      const options: AgentsMdOptions = {
        projectName: 'My App',
        description: 'A custom application for testing',
        template: 'minimal',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('A custom application for testing');
    });

    it('should include custom build and test commands', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Custom Build Project',
        buildCommand: 'yarn build',
        testCommand: 'yarn test:unit',
        template: 'minimal',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('yarn build');
      expect(result).toContain('yarn test:unit');
    });

    it('should include default skills for minimal template', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Minimal Skills',
        template: 'minimal',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('$swarm-orchestration');
      expect(result).toContain('$memory-management');
    });

    it('should include file organization section', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Org Test',
        template: 'minimal',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('/src');
      expect(result).toContain('/tests');
      expect(result).toContain('/docs');
    });
  });

  describe('default template', () => {
    it('should generate a default AGENTS.md with all sections', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Default Project',
        template: 'default',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('# Default Project');
      expect(result).toContain('## Project Overview');
      expect(result).toContain('## Quick Start');
      expect(result).toContain('## Agent Coordination');
      expect(result).toContain('## Code Standards');
      expect(result).toContain('## Security');
      expect(result).toContain('## Memory System');
    });

    it('should include tech stack', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Tech Stack Test',
        techStack: 'React, Node.js, PostgreSQL',
        template: 'default',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('React, Node.js, PostgreSQL');
    });

    it('should include swarm configuration', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Swarm Config',
        template: 'default',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('Topology');
      expect(result).toContain('hierarchical');
      expect(result).toContain('Max Agents');
      expect(result).toContain('raft');
    });

    it('should include agent types table', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Agents Test',
        template: 'default',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('researcher');
      expect(result).toContain('architect');
      expect(result).toContain('coder');
      expect(result).toContain('tester');
      expect(result).toContain('reviewer');
    });

    it('should include custom skills', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Custom Skills',
        skills: ['custom-skill', 'another-skill'],
        template: 'default',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('$custom-skill');
      expect(result).toContain('$another-skill');
      expect(result).toContain('Custom skill');
    });

    it('should include built-in skill descriptions', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Skill Descriptions',
        skills: ['swarm-orchestration', 'memory-management'],
        template: 'default',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('Multi-agent task coordination');
      expect(result).toContain('Pattern storage and retrieval');
    });

    it('should include commit message format', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Commit Test',
        template: 'default',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('Co-Authored-By: ruflo-bot');
      expect(result).toContain('feat');
      expect(result).toContain('fix');
    });
  });

  describe('full template', () => {
    it('should include performance targets', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Full Project',
        template: 'full',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('## Performance Targets');
      expect(result).toContain('HNSW Search');
      expect(result).toContain('150x-12,500x faster');
    });

    it('should include testing section', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Testing Project',
        template: 'full',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('## Testing');
      expect(result).toContain('test:integration');
      expect(result).toContain('test:coverage');
      expect(result).toContain('TDD London School');
    });

    it('should include MCP integration', async () => {
      const options: AgentsMdOptions = {
        projectName: 'MCP Project',
        template: 'full',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('## MCP Integration');
      expect(result).toContain('swarm_init');
      expect(result).toContain('agent_spawn');
      expect(result).toContain('memory_store');
    });

    it('should include hooks system', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Hooks Project',
        template: 'full',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('## Hooks System');
      expect(result).toContain('pre-task');
      expect(result).toContain('post-task');
      expect(result).toContain('pre-edit');
      expect(result).toContain('post-edit');
    });
  });

  describe('enterprise template', () => {
    it('should include governance section', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Enterprise Project',
        template: 'enterprise',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('## Governance');
      expect(result).toContain('Approval Workflow');
      expect(result).toContain('Audit Trail');
      expect(result).toContain('Compliance');
    });

    it('should include compliance standards', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Compliance Project',
        template: 'enterprise',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('SOC2');
      expect(result).toContain('GDPR');
      expect(result).toContain('PCI-DSS');
    });

    it('should include incident response', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Incident Response',
        template: 'enterprise',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('## Incident Response');
      expect(result).toContain('Security Issue');
      expect(result).toContain('Production Bug');
    });
  });

  describe('template fallback', () => {
    it('should use default template when no template specified', async () => {
      const options: AgentsMdOptions = {
        projectName: 'No Template',
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('## Agent Coordination');
      expect(result).toContain('## Memory System');
    });

    it('should use default template for invalid template value', async () => {
      const options: AgentsMdOptions = {
        projectName: 'Invalid Template',
        template: 'invalid-template' as any,
      };

      const result = await generateAgentsMd(options);

      expect(result).toContain('## Agent Coordination');
    });
  });
});

// =============================================================================
// SKILL.md Generator Tests
// =============================================================================

describe('generateSkillMd', () => {
  describe('basic skill generation', () => {
    it('should generate valid YAML frontmatter', async () => {
      const options: SkillMdOptions = {
        name: 'test-skill',
        description: 'A test skill for testing',
      };

      const result = await generateSkillMd(options);

      expect(result).toMatch(/^---\n/);
      expect(result).toContain('name: test-skill');
      expect(result).toContain('description: >');
      expect(result).toContain('A test skill for testing');
      expect(result).toMatch(/---\n\n# Test Skill Skill/);
    });

    it('should include Purpose section', async () => {
      const options: SkillMdOptions = {
        name: 'purpose-skill',
        description: 'Skill with a clear purpose',
      };

      const result = await generateSkillMd(options);

      expect(result).toContain('## Purpose');
      expect(result).toContain('Skill with a clear purpose');
    });

    it('should include When to Trigger section', async () => {
      const options: SkillMdOptions = {
        name: 'trigger-skill',
        description: 'Skill with triggers',
        triggers: ['condition one', 'condition two', 'condition three'],
      };

      const result = await generateSkillMd(options);

      expect(result).toContain('## When to Trigger');
      expect(result).toContain('- condition one');
      expect(result).toContain('- condition two');
      expect(result).toContain('- condition three');
    });

    it('should include When to Skip section', async () => {
      const options: SkillMdOptions = {
        name: 'skip-skill',
        description: 'Skill with skip conditions',
        skipWhen: ['skip condition A', 'skip condition B'],
      };

      const result = await generateSkillMd(options);

      expect(result).toContain('## When to Skip');
      expect(result).toContain('- skip condition A');
      expect(result).toContain('- skip condition B');
    });

    it('should include Best Practices section', async () => {
      const options: SkillMdOptions = {
        name: 'best-practices',
        description: 'Skill with best practices',
      };

      const result = await generateSkillMd(options);

      expect(result).toContain('## Best Practices');
      expect(result).toContain('Check memory for existing patterns');
      expect(result).toContain('hierarchical topology');
    });
  });

  describe('skill with commands', () => {
    it('should generate Commands section', async () => {
      const options: SkillMdOptions = {
        name: 'command-skill',
        description: 'Skill with commands',
        commands: [
          {
            name: 'Initialize',
            description: 'Initialize the skill',
            command: 'npx skill init',
          },
        ],
      };

      const result = await generateSkillMd(options);

      expect(result).toContain('## Commands');
      expect(result).toContain('### Initialize');
      expect(result).toContain('Initialize the skill');
      expect(result).toContain('```bash\nnpx skill init\n```');
    });

    it('should include command examples', async () => {
      const options: SkillMdOptions = {
        name: 'example-skill',
        description: 'Skill with command examples',
        commands: [
          {
            name: 'Run Task',
            description: 'Run a specific task',
            command: 'npx skill run --task [name]',
            example: 'npx skill run --task build',
          },
        ],
      };

      const result = await generateSkillMd(options);

      expect(result).toContain('**Example:**');
      expect(result).toContain('npx skill run --task build');
    });

    it('should handle multiple commands', async () => {
      const options: SkillMdOptions = {
        name: 'multi-command',
        description: 'Skill with multiple commands',
        commands: [
          { name: 'Cmd1', description: 'First command', command: 'cmd1' },
          { name: 'Cmd2', description: 'Second command', command: 'cmd2' },
          { name: 'Cmd3', description: 'Third command', command: 'cmd3' },
        ],
      };

      const result = await generateSkillMd(options);

      expect(result).toContain('### Cmd1');
      expect(result).toContain('### Cmd2');
      expect(result).toContain('### Cmd3');
    });
  });

  describe('skill with scripts', () => {
    it('should generate Scripts section as table', async () => {
      const options: SkillMdOptions = {
        name: 'script-skill',
        description: 'Skill with scripts',
        scripts: [
          { name: 'setup', path: './scripts/setup.sh', description: 'Setup script' },
          { name: 'cleanup', path: './scripts/cleanup.sh', description: 'Cleanup script' },
        ],
      };

      const result = await generateSkillMd(options);

      expect(result).toContain('## Scripts');
      expect(result).toContain('| Script | Path | Description |');
      expect(result).toContain('| `setup` | `./scripts/setup.sh` | Setup script |');
      expect(result).toContain('| `cleanup` | `./scripts/cleanup.sh` | Cleanup script |');
    });
  });

  describe('skill with references', () => {
    it('should generate References section as table', async () => {
      const options: SkillMdOptions = {
        name: 'ref-skill',
        description: 'Skill with references',
        references: [
          { name: 'README', path: './README.md', description: 'Main documentation' },
          { name: 'API', path: './docs/api.md' },
        ],
      };

      const result = await generateSkillMd(options);

      expect(result).toContain('## References');
      expect(result).toContain('| Document | Path | Description |');
      expect(result).toContain('| `README` | `./README.md` | Main documentation |');
      expect(result).toContain('| `API` | `./docs/api.md` |  |');
    });
  });

  describe('skill name formatting', () => {
    it('should format kebab-case names to Title Case', async () => {
      const options: SkillMdOptions = {
        name: 'my-complex-skill-name',
        description: 'Testing name formatting',
      };

      const result = await generateSkillMd(options);

      expect(result).toContain('# My Complex Skill Name Skill');
    });

    it('should handle single-word names', async () => {
      const options: SkillMdOptions = {
        name: 'simple',
        description: 'Simple skill',
      };

      const result = await generateSkillMd(options);

      expect(result).toContain('# Simple Skill');
    });
  });
});

describe('generateBuiltInSkill', () => {
  it('should generate swarm-orchestration skill', async () => {
    const result = await generateBuiltInSkill('swarm-orchestration');

    expect(result.skillMd).toContain('name: swarm-orchestration');
    expect(result.skillMd).toContain('Multi-agent swarm coordination');
    expect(result.skillMd).toContain('Initialize Swarm');
    expect(result.skillMd).toContain('npx ruflo swarm init');
  });

  it('should generate memory-management skill', async () => {
    const result = await generateBuiltInSkill('memory-management');

    expect(result.skillMd).toContain('name: memory-management');
    expect(result.skillMd).toContain('AgentDB memory system');
    expect(result.skillMd).toContain('Store Pattern');
    expect(result.skillMd).toContain('Semantic Search');
  });

  it('should generate sparc-methodology skill', async () => {
    const result = await generateBuiltInSkill('sparc-methodology');

    expect(result.skillMd).toContain('name: sparc-methodology');
    expect(result.skillMd).toContain('SPARC development workflow');
    expect(result.skillMd).toContain('Specification Phase');
    expect(result.skillMd).toContain('Architecture Phase');
  });

  it('should generate security-audit skill', async () => {
    const result = await generateBuiltInSkill('security-audit');

    expect(result.skillMd).toContain('name: security-audit');
    expect(result.skillMd).toContain('security scanning');
    expect(result.skillMd).toContain('Full Security Scan');
    expect(result.skillMd).toContain('--depth full');
  });

  it('should generate performance-analysis skill', async () => {
    const result = await generateBuiltInSkill('performance-analysis');

    expect(result.skillMd).toContain('name: performance-analysis');
    expect(result.skillMd).toContain('Performance profiling');
    expect(result.skillMd).toContain('Run Benchmark');
    expect(result.skillMd).toContain('Profile Code');
  });

  it('should generate github-automation skill', async () => {
    const result = await generateBuiltInSkill('github-automation');

    expect(result.skillMd).toContain('name: github-automation');
    expect(result.skillMd).toContain('GitHub workflow automation');
    expect(result.skillMd).toContain('Create Pull Request');
    expect(result.skillMd).toContain('gh pr create');
  });

  it('should throw for unknown skill', async () => {
    await expect(generateBuiltInSkill('unknown-skill')).rejects.toThrow(
      'Unknown built-in skill: unknown-skill'
    );
  });

  it('should return generated scripts for skills with scripts', async () => {
    const result = await generateBuiltInSkill('swarm-orchestration');

    // Scripts are now generated for skills that have them
    expect(Object.keys(result.scripts).length).toBeGreaterThan(0);
    expect(result.references).toEqual({});
  });

  it('should generate valid bash scripts', async () => {
    const result = await generateBuiltInSkill('memory-management');

    // Check that scripts are generated and contain bash shebang
    for (const script of Object.values(result.scripts)) {
      expect(script).toContain('#!/bin/bash');
      expect(script).toContain('set -e');
    }
  });
});

// =============================================================================
// config.toml Generator Tests
// =============================================================================

describe('generateConfigToml', () => {
  describe('default configuration', () => {
    it('should generate valid TOML with header', async () => {
      const result = await generateConfigToml({ platform: 'linux' });

      expect(result).toContain('# Claude Flow V3 - Codex Configuration');
      expect(result).toContain('# Generated by: @claude-flow/codex');
      expect(result).toContain('# Documentation: https://github.com/ruvnet/ruflo');
    });

    it('should include core settings section', async () => {
      const result = await generateConfigToml();

      expect(result).toContain('# Core Settings');
      expect(result).toContain('model = "gpt-5.3-codex"');
      expect(result).toContain('approval_policy = "on-request"');
      expect(result).toContain('sandbox_mode = "workspace-write"');
      expect(result).toContain('web_search = "cached"');
    });

    it('should include project documentation settings', async () => {
      const result = await generateConfigToml();

      expect(result).toContain('# Project Documentation');
      expect(result).toContain('project_doc_max_bytes = 65536');
      expect(result).toContain('project_doc_fallback_filenames');
      expect(result).toContain('"AGENTS.md"');
    });

    it('should include features section', async () => {
      const result = await generateConfigToml();

      expect(result).toContain('[features]');
      expect(result).toContain('child_agents_md = true');
      expect(result).toContain('shell_snapshot = true');
      expect(result).toContain('request_rule = true');
      expect(result).toContain('remote_compaction = true');
    });

    it('should include default ruflo MCP server', async () => {
      const result = await generateConfigToml({ platform: 'linux' });

      expect(result).toContain('[mcp_servers.ruflo]');
      expect(result).toContain('command = "npx"');
      expect(result).toContain('args = ["-y", "ruflo@latest", "mcp", "start"]');
      expect(result).toContain('enabled = true');
    });

    it('should include default profiles', async () => {
      const result = await generateConfigToml();

      expect(result).toContain('[profiles.dev]');
      expect(result).toContain('approval_policy = "never"');
      expect(result).toContain('sandbox_mode = "danger-full-access"');

      expect(result).toContain('[profiles.safe]');
      expect(result).toContain('sandbox_mode = "read-only"');

      expect(result).toContain('[profiles.ci]');
      expect(result).toContain('sandbox_mode = "workspace-write"');
    });

    it('should include history section', async () => {
      const result = await generateConfigToml();

      expect(result).toContain('[history]');
      expect(result).toContain('persistence = "save-all"');
    });

    it('should include shell environment policy', async () => {
      const result = await generateConfigToml();

      expect(result).toContain('[shell_environment_policy]');
      expect(result).toContain('inherit = "core"');
      expect(result).toContain('exclude = ["*_KEY", "*_SECRET", "*_TOKEN", "*_PASSWORD"]');
    });

    it('should include sandbox workspace settings', async () => {
      const result = await generateConfigToml();

      expect(result).toContain('[sandbox_workspace_write]');
      expect(result).toContain('writable_roots = []');
      expect(result).toContain('network_access = true');
      expect(result).toContain('exclude_slash_tmp = false');
    });
  });

  describe('custom model and policies', () => {
    it('should accept custom model', async () => {
      const options: ConfigTomlOptions = {
        model: 'gpt-4o-mini',
      };

      const result = await generateConfigToml(options);

      expect(result).toContain('model = "gpt-4o-mini"');
    });

    it('should accept custom approval policy', async () => {
      const options: ConfigTomlOptions = {
        approvalPolicy: 'never',
      };

      const result = await generateConfigToml(options);

      expect(result).toContain('approval_policy = "never"');
    });

    it('should accept custom sandbox mode', async () => {
      const options: ConfigTomlOptions = {
        sandboxMode: 'read-only',
      };

      const result = await generateConfigToml(options);

      expect(result).toContain('sandbox_mode = "read-only"');
    });

    it('should accept custom web search mode', async () => {
      const options: ConfigTomlOptions = {
        webSearch: 'live',
      };

      const result = await generateConfigToml(options);

      expect(result).toContain('web_search = "live"');
    });
  });

  describe('custom features', () => {
    it('should allow disabling features', async () => {
      const options: ConfigTomlOptions = {
        features: {
          childAgentsMd: false,
          shellSnapshot: false,
          requestRule: false,
          remoteCompaction: false,
        },
      };

      const result = await generateConfigToml(options);

      expect(result).toContain('child_agents_md = false');
      expect(result).toContain('shell_snapshot = false');
      expect(result).toContain('request_rule = false');
      expect(result).toContain('remote_compaction = false');
    });
  });

  describe('MCP servers configuration', () => {
    it('should add custom MCP servers', async () => {
      const options: ConfigTomlOptions = {
        mcpServers: [
          {
            name: 'custom-server',
            command: 'node',
            args: ['./server.js'],
            enabled: true,
            toolTimeout: 60,
          },
        ],
      };

      const result = await generateConfigToml(options);

      expect(result).toContain('[mcp_servers.custom-server]');
      expect(result).toContain('command = "node"');
      expect(result).toContain('args = ["./server.js"]');
      expect(result).toContain('tool_timeout_sec = 60');
    });

    it('should add MCP server with environment variables', async () => {
      const options: ConfigTomlOptions = {
        mcpServers: [
          {
            name: 'env-server',
            command: 'node',
            args: ['./server.js'],
            env: {
              NODE_ENV: 'production',
              API_KEY: '${API_KEY}',
            },
          },
        ],
      };

      const result = await generateConfigToml(options);

      expect(result).toContain('[mcp_servers.env-server.env]');
      expect(result).toContain('NODE_ENV = "production"');
      expect(result).toContain('API_KEY = "${API_KEY}"');
    });

    it('should not duplicate claude-flow server if already specified', async () => {
      const options: ConfigTomlOptions = {
        mcpServers: [
          {
            name: 'claude-flow',
            command: 'custom-claude-flow',
            args: ['--custom'],
          },
        ],
      };

      const result = await generateConfigToml(options);

      const matches = result.match(/\[mcp_servers\.claude-flow\]/g);
      expect(matches).toHaveLength(1);
      expect(result).toContain('command = "custom-claude-flow"');
    });
  });

  describe('skills configuration', () => {
    it('should add skill configurations', async () => {
      const options: ConfigTomlOptions = {
        skills: [
          { path: './.agents/skills/custom-skill/', enabled: true },
          { path: './.agents/skills/another-skill/', enabled: false },
        ],
      };

      const result = await generateConfigToml(options);

      expect(result).toContain('# Skills Configuration');
      expect(result).toContain('[[skills.config]]');
      expect(result).toContain('path = "./.agents/skills/custom-skill/"');
      expect(result).toContain('enabled = true');
      expect(result).toContain('path = "./.agents/skills/another-skill/"');
      expect(result).toContain('enabled = false');
    });
  });

  describe('custom profiles', () => {
    it('should merge custom profiles with defaults', async () => {
      const options: ConfigTomlOptions = {
        profiles: {
          staging: {
            approvalPolicy: 'on-failure',
            sandboxMode: 'workspace-write',
            webSearch: 'cached',
          },
        },
      };

      const result = await generateConfigToml(options);

      expect(result).toContain('[profiles.dev]');
      expect(result).toContain('[profiles.safe]');
      expect(result).toContain('[profiles.ci]');
      expect(result).toContain('[profiles.staging]');
      expect(result).toContain('approval_policy = "on-failure"');
    });
  });

  describe('history persistence', () => {
    it('should allow custom history persistence', async () => {
      const options: ConfigTomlOptions = {
        historyPersistence: 'none',
      };

      const result = await generateConfigToml(options);

      expect(result).toContain('persistence = "none"');
    });
  });
});

describe('generateMinimalConfigToml', () => {
  it('should generate minimal config', async () => {
    const result = await generateMinimalConfigToml();

    expect(result).toContain('# Claude Flow V3 - Minimal Codex Configuration');
    expect(result).toContain('model = "gpt-5.3-codex"');
    expect(result).toContain('approval_policy = "on-request"');
    expect(result).toContain('sandbox_mode = "workspace-write"');
    expect(result).toContain('[mcp_servers.ruflo]');
  });

  it('should accept custom options', async () => {
    const result = await generateMinimalConfigToml({
      model: 'custom-model',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    });

    expect(result).toContain('model = "custom-model"');
    expect(result).toContain('approval_policy = "never"');
    expect(result).toContain('sandbox_mode = "danger-full-access"');
  });

  it('should be much shorter than full config', async () => {
    const minimal = await generateMinimalConfigToml();
    const full = await generateConfigToml();

    expect(minimal.length).toBeLessThan(full.length / 3);
  });
});

describe('generateCIConfigToml', () => {
  it('should generate CI-specific config', async () => {
    const result = await generateCIConfigToml();

    expect(result).toContain('# Claude Flow V3 - CI/CD Pipeline Configuration');
    expect(result).toContain('approval_policy = "never"');
    expect(result).toContain('web_search = "disabled"');
  });

  it('should disable shell snapshot for CI', async () => {
    const result = await generateCIConfigToml();

    expect(result).toContain('shell_snapshot = false');
    expect(result).toContain('remote_compaction = false');
  });

  it('should disable history persistence', async () => {
    const result = await generateCIConfigToml();

    expect(result).toContain('persistence = "none"');
  });

  it('should generate a Windows-safe Ruflo MCP command with startup headroom', async () => {
    const result = await generateCIConfigToml('win32');

    expect(result).toContain('command = "cmd"');
    expect(result).toContain('args = ["/c", "npx", "-y", "ruflo@latest", "mcp", "start"]');
    expect(result).toContain('startup_timeout_sec = 120');
    expect(result).toContain('tool_timeout_sec = 300');
  });
});
