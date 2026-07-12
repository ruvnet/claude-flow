/**
 * @claude-flow/codex - SKILL.md Generator
 *
 * Generates SKILL.md files for OpenAI Codex CLI skills
 * Uses YAML frontmatter for metadata
 */

import type { SkillMdOptions, SkillCommand } from '../types.js';

/**
 * Generate a SKILL.md file based on the provided options
 */
export async function generateSkillMd(options: SkillMdOptions): Promise<string> {
  const {
    name,
    description,
    version = '1.0.0',
    author = 'rUv',
    tags,
    triggers = [],
    skipWhen = [],
    scripts = [],
    references = [],
    commands = [],
  } = options;

  // Derive discovery tags from the skill name when not supplied explicitly.
  const tagList = tags && tags.length > 0 ? tags : name.split('-').filter(Boolean);

  // Build YAML frontmatter
  const triggerText = triggers.length > 0
    ? `Use when: ${triggers.join(', ')}.`
    : '';
  const skipText = skipWhen.length > 0
    ? `Skip when: ${skipWhen.join(', ')}.`
    : '';

  const frontmatter = `---
name: ${name}
version: "${version}"
author: ${author}
tags: [${tagList.join(', ')}]
description: >
  ${description}
  ${triggerText}
  ${skipText}
---`;

  // Build commands section
  const commandsSection = commands.length > 0
    ? buildCommandsSection(commands)
    : '';

  // Build scripts section
  const scriptsSection = scripts.length > 0
    ? buildScriptsSection(scripts)
    : '';

  // Build references section
  const referencesSection = references.length > 0
    ? buildReferencesSection(references)
    : '';

  // Combine all sections
  return `${frontmatter}

# ${formatSkillName(name)} Skill

## Purpose
${description}

## When to Trigger
${triggers.length > 0 ? triggers.map(t => `- ${t}`).join('\n') : '- Define triggers for this skill'}

## When to Skip
${skipWhen.length > 0 ? skipWhen.map(s => `- ${s}`).join('\n') : '- Define skip conditions for this skill'}
${commandsSection}
${scriptsSection}
${referencesSection}
## Best Practices
1. Check memory for existing patterns before starting
2. Use hierarchical topology for coordination
3. Store successful patterns after completion
4. Document any new learnings
`;
}

/**
 * Build the commands section of the SKILL.md
 */
function buildCommandsSection(commands: SkillCommand[]): string {
  const lines = commands.map(cmd => {
    let block = `### ${cmd.name}\n${cmd.description}\n\n\`\`\`bash\n${cmd.command}\n\`\`\``;
    if (cmd.example) {
      block += `\n\n**Example:**\n\`\`\`bash\n${cmd.example}\n\`\`\``;
    }
    return block;
  });

  return `
## Commands

${lines.join('\n\n')}
`;
}

/**
 * Build the scripts section
 */
function buildScriptsSection(scripts: { name: string; path: string; description: string }[]): string {
  const lines = scripts.map(s => `| \`${s.name}\` | \`${s.path}\` | ${s.description} |`);

  return `
## Scripts

| Script | Path | Description |
|--------|------|-------------|
${lines.join('\n')}
`;
}

/**
 * Build the references section
 */
function buildReferencesSection(references: { name: string; path: string; description?: string }[]): string {
  const lines = references.map(r =>
    `| \`${r.name}\` | \`${r.path}\` | ${r.description ?? ''} |`
  );

  return `
## References

| Document | Path | Description |
|----------|------|-------------|
${lines.join('\n')}
`;
}

/**
 * Format skill name for display (kebab-case to Title Case)
 */
function formatSkillName(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Generate a skill from a built-in template
 */
export async function generateBuiltInSkill(
  skillName: string
): Promise<{ skillMd: string; scripts: Record<string, string>; references: Record<string, string> }> {
  const skillTemplates: Record<string, SkillMdOptions> = {
    'swarm-orchestration': {
      name: 'swarm-orchestration',
      description: 'Multi-agent swarm coordination for complex tasks. Uses hierarchical topology with specialized agents to break down and execute complex work across multiple files and modules.',
      triggers: [
        '3+ files need changes',
        'new feature implementation',
        'cross-module refactoring',
        'API changes with tests',
        'security-related changes',
        'performance optimization across codebase',
        'database schema changes',
      ],
      skipWhen: [
        'single file edits',
        'simple bug fixes (1-2 lines)',
        'documentation updates',
        'configuration changes',
        'quick exploration',
      ],
      commands: [
        {
          name: 'Initialize Swarm',
          description: 'Start a new swarm with hierarchical topology (anti-drift)',
          command: 'npx ruflo swarm init --topology hierarchical --max-agents 8 --strategy specialized',
          example: 'npx ruflo swarm init --topology hierarchical --max-agents 6 --strategy specialized',
        },
        {
          name: 'Route Task',
          description: 'Route a task to the appropriate agents based on task type',
          command: 'npx @claude-flow/cli hooks route --task "[task description]"',
          example: 'npx @claude-flow/cli hooks route --task "implement OAuth2 authentication flow"',
        },
        {
          name: 'Spawn Agent',
          description: 'Spawn a specific agent type',
          command: 'npx @claude-flow/cli agent spawn --type [type] --name [name]',
          example: 'npx @claude-flow/cli agent spawn --type coder --name impl-auth',
        },
        {
          name: 'Monitor Status',
          description: 'Check the current swarm status',
          command: 'npx @claude-flow/cli swarm status --verbose',
        },
        {
          name: 'Orchestrate Task',
          description: 'Orchestrate a task across multiple agents',
          command: 'npx @claude-flow/cli task orchestrate --task "[task]" --strategy adaptive',
          example: 'npx @claude-flow/cli task orchestrate --task "refactor auth module" --strategy parallel --max-agents 4',
        },
        {
          name: 'List Agents',
          description: 'List all active agents',
          command: 'npx @claude-flow/cli agent list --filter active',
        },
      ],
      scripts: [
        {
          name: 'swarm-start',
          path: '.agents/scripts/swarm-start.sh',
          description: 'Initialize swarm with default settings',
        },
        {
          name: 'swarm-monitor',
          path: '.agents/scripts/swarm-monitor.sh',
          description: 'Real-time swarm monitoring dashboard',
        },
      ],
      references: [
        {
          name: 'Agent Types',
          path: 'docs/agents.md',
          description: 'Complete list of agent types and capabilities',
        },
        {
          name: 'Topology Guide',
          path: 'docs/topology.md',
          description: 'Swarm topology configuration guide',
        },
      ],
    },
    'memory-management': {
      name: 'memory-management',
      description: 'AgentDB memory system with HNSW vector search. Provides 150x-12,500x faster pattern retrieval, persistent storage, and semantic search capabilities for learning and knowledge management.',
      triggers: [
        'need to store successful patterns',
        'searching for similar solutions',
        'semantic lookup of past work',
        'learning from previous tasks',
        'sharing knowledge between agents',
        'building knowledge base',
      ],
      skipWhen: [
        'no learning needed',
        'ephemeral one-off tasks',
        'external data sources available',
        'read-only exploration',
      ],
      commands: [
        {
          name: 'Store Pattern',
          description: 'Store a pattern or knowledge item in memory',
          command: 'npx @claude-flow/cli memory store --key "[key]" --value "[value]" --namespace patterns',
          example: 'npx @claude-flow/cli memory store --key "auth-jwt-pattern" --value "JWT validation with refresh tokens" --namespace patterns',
        },
        {
          name: 'Semantic Search',
          description: 'Search memory using semantic similarity',
          command: 'npx @claude-flow/cli memory search --query "[search terms]" --limit 10',
          example: 'npx @claude-flow/cli memory search --query "authentication best practices" --limit 5',
        },
        {
          name: 'Retrieve Entry',
          description: 'Retrieve a specific memory entry by key',
          command: 'npx @claude-flow/cli memory get --key "[key]" --namespace [namespace]',
          example: 'npx @claude-flow/cli memory get --key "auth-jwt-pattern" --namespace patterns',
        },
        {
          name: 'List Entries',
          description: 'List all entries in a namespace',
          command: 'npx @claude-flow/cli memory list --namespace [namespace]',
          example: 'npx @claude-flow/cli memory list --namespace patterns --limit 20',
        },
        {
          name: 'Delete Entry',
          description: 'Delete a memory entry',
          command: 'npx @claude-flow/cli memory delete --key "[key]" --namespace [namespace]',
        },
        {
          name: 'Initialize HNSW Index',
          description: 'Initialize HNSW vector search index',
          command: 'npx @claude-flow/cli memory init --enable-hnsw',
        },
        {
          name: 'Memory Stats',
          description: 'Show memory usage statistics',
          command: 'npx @claude-flow/cli memory stats',
        },
        {
          name: 'Export Memory',
          description: 'Export memory to JSON',
          command: 'npx @claude-flow/cli memory export --output memory-backup.json',
        },
      ],
      scripts: [
        {
          name: 'memory-backup',
          path: '.agents/scripts/memory-backup.sh',
          description: 'Backup memory to external storage',
        },
        {
          name: 'memory-consolidate',
          path: '.agents/scripts/memory-consolidate.sh',
          description: 'Consolidate and optimize memory',
        },
      ],
      references: [
        {
          name: 'HNSW Guide',
          path: 'docs/hnsw.md',
          description: 'HNSW vector search configuration',
        },
        {
          name: 'Memory Schema',
          path: 'docs/memory-schema.md',
          description: 'Memory namespace and schema reference',
        },
      ],
    },
    'sparc-methodology': {
      name: 'sparc-methodology',
      description: 'SPARC development workflow: Specification, Pseudocode, Architecture, Refinement, Completion. A structured approach for complex implementations that ensures thorough planning before coding.',
      triggers: [
        'new feature implementation',
        'complex implementations',
        'architectural changes',
        'system redesign',
        'integration work',
        'unclear requirements',
      ],
      skipWhen: [
        'simple bug fixes',
        'documentation updates',
        'configuration changes',
        'well-defined small tasks',
        'routine maintenance',
      ],
      commands: [
        {
          name: 'Specification Phase',
          description: 'Define requirements, acceptance criteria, and constraints',
          command: 'npx @claude-flow/cli hooks route --task "specification: [requirements]"',
          example: 'npx @claude-flow/cli hooks route --task "specification: user authentication with OAuth2, MFA, and session management"',
        },
        {
          name: 'Pseudocode Phase',
          description: 'Write high-level pseudocode for the implementation',
          command: 'npx @claude-flow/cli hooks route --task "pseudocode: [feature]"',
          example: 'npx @claude-flow/cli hooks route --task "pseudocode: OAuth2 login flow with token refresh"',
        },
        {
          name: 'Architecture Phase',
          description: 'Design system structure, interfaces, and dependencies',
          command: 'npx @claude-flow/cli hooks route --task "architecture: [design]"',
          example: 'npx @claude-flow/cli hooks route --task "architecture: auth module with service layer, repository, and API endpoints"',
        },
        {
          name: 'Refinement Phase',
          description: 'Iterate on the design based on feedback',
          command: 'npx @claude-flow/cli hooks route --task "refinement: [feedback]"',
          example: 'npx @claude-flow/cli hooks route --task "refinement: add rate limiting and brute force protection"',
        },
        {
          name: 'Completion Phase',
          description: 'Finalize implementation with tests and documentation',
          command: 'npx @claude-flow/cli hooks route --task "completion: [final checks]"',
          example: 'npx @claude-flow/cli hooks route --task "completion: verify all tests pass, update API docs, security review"',
        },
        {
          name: 'SPARC Coordinator',
          description: 'Spawn SPARC coordinator agent',
          command: 'npx @claude-flow/cli agent spawn --type sparc-coord --name sparc-lead',
        },
      ],
      scripts: [
        {
          name: 'sparc-init',
          path: '.agents/scripts/sparc-init.sh',
          description: 'Initialize SPARC workflow for a new feature',
        },
        {
          name: 'sparc-review',
          path: '.agents/scripts/sparc-review.sh',
          description: 'Run SPARC phase review checklist',
        },
      ],
      references: [
        {
          name: 'SPARC Overview',
          path: 'docs/sparc.md',
          description: 'Complete SPARC methodology guide',
        },
        {
          name: 'Phase Templates',
          path: 'docs/sparc-templates.md',
          description: 'Templates for each SPARC phase',
        },
      ],
    },
    'security-audit': {
      name: 'security-audit',
      description: 'Comprehensive security scanning and vulnerability detection. Includes input validation, path traversal prevention, CVE detection, and secure coding pattern enforcement.',
      triggers: [
        'authentication implementation',
        'authorization logic',
        'payment processing',
        'user data handling',
        'API endpoint creation',
        'file upload handling',
        'database queries',
        'external API integration',
      ],
      skipWhen: [
        'read-only operations on public data',
        'internal development tooling',
        'static documentation',
        'styling changes',
      ],
      commands: [
        {
          name: 'Full Security Scan',
          description: 'Run comprehensive security analysis on the codebase',
          command: 'npx @claude-flow/cli security scan --depth deep',
          example: 'npx @claude-flow/cli security scan --depth deep --output security-report.json',
        },
        {
          name: 'Input Validation Check',
          description: 'Check for input validation issues',
          command: 'npx @claude-flow/cli security scan --check input-validation',
          example: 'npx @claude-flow/cli security scan --check input-validation --path ./src/api',
        },
        {
          name: 'Path Traversal Check',
          description: 'Check for path traversal vulnerabilities',
          command: 'npx @claude-flow/cli security scan --check path-traversal',
        },
        {
          name: 'SQL Injection Check',
          description: 'Check for SQL injection vulnerabilities',
          command: 'npx @claude-flow/cli security scan --check sql-injection',
        },
        {
          name: 'XSS Check',
          description: 'Check for cross-site scripting vulnerabilities',
          command: 'npx @claude-flow/cli security scan --check xss',
        },
        {
          name: 'CVE Scan',
          description: 'Scan dependencies for known CVEs',
          command: 'npx @claude-flow/cli security cve --scan',
          example: 'npx @claude-flow/cli security cve --scan --severity high',
        },
        {
          name: 'Security Audit Report',
          description: 'Generate full security audit report',
          command: 'npx @claude-flow/cli security audit --report',
          example: 'npx @claude-flow/cli security audit --report --format markdown --output SECURITY.md',
        },
        {
          name: 'Threat Modeling',
          description: 'Run threat modeling analysis',
          command: 'npx @claude-flow/cli security threats --analyze',
        },
        {
          name: 'Validate Secrets',
          description: 'Check for hardcoded secrets',
          command: 'npx @claude-flow/cli security validate --check secrets',
        },
      ],
      scripts: [
        {
          name: 'security-scan',
          path: '.agents/scripts/security-scan.sh',
          description: 'Run full security scan pipeline',
        },
        {
          name: 'cve-remediate',
          path: '.agents/scripts/cve-remediate.sh',
          description: 'Auto-remediate known CVEs',
        },
      ],
      references: [
        {
          name: 'Security Checklist',
          path: 'docs/security-checklist.md',
          description: 'Security review checklist',
        },
        {
          name: 'OWASP Guide',
          path: 'docs/owasp-top10.md',
          description: 'OWASP Top 10 mitigation guide',
        },
      ],
    },
    'performance-analysis': {
      name: 'performance-analysis',
      description: 'Performance profiling, benchmarking, and optimization. Includes CPU profiling, memory analysis, latency measurement, and automated optimization suggestions.',
      triggers: [
        'slow operations detected',
        'memory usage issues',
        'optimization needed',
        'pre-release performance validation',
        'database query optimization',
        'API latency concerns',
        'bundle size analysis',
      ],
      skipWhen: [
        'early feature development',
        'documentation updates',
        'prototyping phase',
        'configuration changes',
      ],
      commands: [
        {
          name: 'Run Benchmark Suite',
          description: 'Execute all performance benchmarks',
          command: 'npx @claude-flow/cli performance benchmark --suite all',
          example: 'npx @claude-flow/cli performance benchmark --suite all --iterations 100 --output bench-results.json',
        },
        {
          name: 'Profile Code',
          description: 'Profile code execution for CPU and memory',
          command: 'npx @claude-flow/cli performance profile --target ./src',
          example: 'npx @claude-flow/cli performance profile --target ./src/api --duration 60s',
        },
        {
          name: 'Memory Analysis',
          description: 'Analyze memory usage patterns',
          command: 'npx @claude-flow/cli performance metrics --metric memory',
          example: 'npx @claude-flow/cli performance metrics --metric memory --threshold 100MB',
        },
        {
          name: 'Latency Analysis',
          description: 'Measure and analyze latency',
          command: 'npx @claude-flow/cli performance metrics --metric latency',
        },
        {
          name: 'Optimize Suggestions',
          description: 'Get automated optimization suggestions',
          command: 'npx @claude-flow/cli performance optimize --analyze',
          example: 'npx @claude-flow/cli performance optimize --analyze --apply-safe',
        },
        {
          name: 'Performance Report',
          description: 'Generate performance report',
          command: 'npx @claude-flow/cli performance report',
          example: 'npx @claude-flow/cli performance report --format html --output perf-report.html',
        },
        {
          name: 'Compare Benchmarks',
          description: 'Compare benchmark results',
          command: 'npx @claude-flow/cli performance benchmark --compare baseline.json current.json',
        },
        {
          name: 'WASM Benchmark',
          description: 'Run WASM-specific benchmarks',
          command: 'npx @claude-flow/cli performance benchmark --suite wasm',
        },
      ],
      scripts: [
        {
          name: 'perf-baseline',
          path: '.agents/scripts/perf-baseline.sh',
          description: 'Capture performance baseline',
        },
        {
          name: 'perf-regression',
          path: '.agents/scripts/perf-regression.sh',
          description: 'Check for performance regressions',
        },
      ],
      references: [
        {
          name: 'Performance Guide',
          path: 'docs/performance.md',
          description: 'Performance optimization guide',
        },
        {
          name: 'Benchmark Reference',
          path: 'docs/benchmarks.md',
          description: 'Benchmark configuration reference',
        },
      ],
    },
    'github-automation': {
      name: 'github-automation',
      description: 'GitHub workflow automation including PR management, CI/CD, issue tracking, and release management. Integrates with GitHub CLI for seamless automation.',
      triggers: [
        'creating pull requests',
        'setting up CI/CD pipelines',
        'release management',
        'issue tracking automation',
        'branch management',
        'code review workflows',
        'repository maintenance',
      ],
      skipWhen: [
        'local-only development',
        'prototyping without commits',
        'non-GitHub repositories',
        'offline work',
      ],
      commands: [
        {
          name: 'Create Pull Request',
          description: 'Create a new pull request with summary',
          command: 'gh pr create --title "[title]" --body "[description]"',
          example: 'gh pr create --title "feat: add OAuth2 authentication" --body "## Summary\\n- Implemented OAuth2 flow\\n- Added token refresh\\n\\n## Test Plan\\n- Run auth tests"',
        },
        {
          name: 'View PR',
          description: 'View pull request details',
          command: 'gh pr view [number]',
          example: 'gh pr view 123 --comments',
        },
        {
          name: 'Merge PR',
          description: 'Merge a pull request',
          command: 'gh pr merge [number] --squash',
          example: 'gh pr merge 123 --squash --delete-branch',
        },
        {
          name: 'Run Workflow',
          description: 'Trigger a GitHub Actions workflow',
          command: 'gh workflow run [workflow]',
          example: 'gh workflow run ci.yml --ref feature-branch',
        },
        {
          name: 'View Workflow Runs',
          description: 'List recent workflow runs',
          command: 'gh run list --limit 10',
        },
        {
          name: 'Create Issue',
          description: 'Create a new issue',
          command: 'gh issue create --title "[title]" --body "[body]"',
          example: 'gh issue create --title "Bug: login fails on mobile" --body "## Description\\n..." --label bug',
        },
        {
          name: 'Create Release',
          description: 'Create a new release',
          command: 'gh release create [tag] --notes "[notes]"',
          example: 'gh release create v1.0.0 --notes "Initial release" --generate-notes',
        },
        {
          name: 'View Checks',
          description: 'View PR check status',
          command: 'gh pr checks [number]',
          example: 'gh pr checks 123 --watch',
        },
        {
          name: 'Review PR',
          description: 'Submit a PR review',
          command: 'gh pr review [number] --approve --body "[comment]"',
          example: 'gh pr review 123 --approve --body "LGTM! Great work on the tests."',
        },
      ],
      scripts: [
        {
          name: 'pr-template',
          path: '.agents/scripts/pr-template.sh',
          description: 'Generate PR from template',
        },
        {
          name: 'release-prep',
          path: '.agents/scripts/release-prep.sh',
          description: 'Prepare release with changelog',
        },
      ],
      references: [
        {
          name: 'GitHub CLI Reference',
          path: 'docs/gh-cli.md',
          description: 'GitHub CLI command reference',
        },
        {
          name: 'PR Guidelines',
          path: 'docs/pr-guidelines.md',
          description: 'Pull request best practices',
        },
        {
          name: 'CI/CD Setup',
          path: 'docs/ci-cd.md',
          description: 'CI/CD pipeline configuration',
        },
      ],
    },
  };

  const template = skillTemplates[skillName];
  if (!template) {
    throw new Error(`Unknown built-in skill: ${skillName}`);
  }

  const skillMd = await generateSkillMd(template);

  // Generate helper scripts
  const scripts: Record<string, string> = {};
  if (template.scripts) {
    for (const script of template.scripts) {
      // Use just the script filename, not the full path
      const scriptFilename = `${script.name}.sh`;
      scripts[scriptFilename] = generateHelperScript(skillName, script.name);
    }
  }

  return {
    skillMd,
    scripts,
    references: {},
  };
}

/**
 * Generate a helper script for a skill
 */
function generateHelperScript(skillName: string, scriptName: string): string {
  const scripts: Record<string, Record<string, string>> = {
    'swarm-orchestration': {
      'swarm-start': `#!/bin/bash
# Swarm Orchestration - Start Script
# Initialize swarm with default anti-drift settings

set -e

echo "Initializing hierarchical swarm..."
npx ruflo swarm init \\
  --topology hierarchical \\
  --max-agents 8 \\
  --strategy specialized

echo "Swarm initialized successfully"
npx @claude-flow/cli swarm status
`,
      'swarm-monitor': `#!/bin/bash
# Swarm Orchestration - Monitor Script
# Real-time swarm monitoring

set -e

echo "Starting swarm monitor..."
npx @claude-flow/cli swarm status --watch --interval 5
`,
    },
    'memory-management': {
      'memory-backup': `#!/bin/bash
# Memory Management - Backup Script
# Export memory to backup file

set -e

BACKUP_DIR="\${BACKUP_DIR:-./.backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="\${BACKUP_DIR}/memory_\${TIMESTAMP}.json"

mkdir -p "$BACKUP_DIR"

echo "Backing up memory to $BACKUP_FILE..."
npx @claude-flow/cli memory export --output "$BACKUP_FILE"

echo "Backup complete: $BACKUP_FILE"
`,
      'memory-consolidate': `#!/bin/bash
# Memory Management - Consolidate Script
# Optimize and consolidate memory

set -e

echo "Running memory consolidation..."
npx @claude-flow/cli hooks worker dispatch --trigger consolidate

echo "Memory consolidation complete"
npx @claude-flow/cli memory stats
`,
    },
    'sparc-methodology': {
      'sparc-init': `#!/bin/bash
# SPARC Methodology - Init Script
# Initialize SPARC workflow for a new feature

set -e

FEATURE_NAME="\${1:-new-feature}"

echo "Initializing SPARC workflow for: $FEATURE_NAME"

# Create SPARC documentation directory
mkdir -p "./docs/sparc/$FEATURE_NAME"

# Create phase files
touch "./docs/sparc/$FEATURE_NAME/1-specification.md"
touch "./docs/sparc/$FEATURE_NAME/2-pseudocode.md"
touch "./docs/sparc/$FEATURE_NAME/3-architecture.md"
touch "./docs/sparc/$FEATURE_NAME/4-refinement.md"
touch "./docs/sparc/$FEATURE_NAME/5-completion.md"

echo "SPARC workflow initialized in ./docs/sparc/$FEATURE_NAME"
`,
      'sparc-review': `#!/bin/bash
# SPARC Methodology - Review Script
# Run SPARC phase review checklist

set -e

FEATURE_DIR="\${1:-.}"

echo "SPARC Phase Review Checklist"
echo "============================="

for phase in specification pseudocode architecture refinement completion; do
  if [ -f "$FEATURE_DIR/\${phase}.md" ]; then
    echo "[x] $phase - found"
  else
    echo "[ ] $phase - missing"
  fi
done
`,
    },
    'security-audit': {
      'security-scan': `#!/bin/bash
# Security Audit - Full Scan Script
# Run comprehensive security scan pipeline

set -e

echo "Running full security scan..."

# Input validation
echo "Checking input validation..."
npx @claude-flow/cli security scan --check input-validation

# Path traversal
echo "Checking path traversal..."
npx @claude-flow/cli security scan --check path-traversal

# SQL injection
echo "Checking SQL injection..."
npx @claude-flow/cli security scan --check sql-injection

# XSS
echo "Checking XSS..."
npx @claude-flow/cli security scan --check xss

# Secrets
echo "Checking for hardcoded secrets..."
npx @claude-flow/cli security validate --check secrets

# CVE scan
echo "Scanning dependencies for CVEs..."
npx @claude-flow/cli security cve --scan

echo "Security scan complete"
`,
      'cve-remediate': `#!/bin/bash
# Security Audit - CVE Remediation Script
# Auto-remediate known CVEs

set -e

echo "Scanning for CVEs..."
npx @claude-flow/cli security cve --scan --severity high

echo "Attempting auto-remediation..."
npm audit fix

echo "Re-scanning after remediation..."
npx @claude-flow/cli security cve --scan

echo "CVE remediation complete"
`,
    },
    'performance-analysis': {
      'perf-baseline': `#!/bin/bash
# Performance Analysis - Baseline Script
# Capture performance baseline

set -e

BASELINE_FILE="\${1:-baseline.json}"

echo "Capturing performance baseline..."
npx @claude-flow/cli performance benchmark \\
  --suite all \\
  --iterations 100 \\
  --output "$BASELINE_FILE"

echo "Baseline saved to $BASELINE_FILE"
`,
      'perf-regression': `#!/bin/bash
# Performance Analysis - Regression Check Script
# Check for performance regressions

set -e

BASELINE_FILE="\${1:-baseline.json}"
CURRENT_FILE="current.json"
THRESHOLD="\${2:-10}"

echo "Running current benchmarks..."
npx @claude-flow/cli performance benchmark \\
  --suite all \\
  --iterations 100 \\
  --output "$CURRENT_FILE"

echo "Comparing against baseline..."
npx @claude-flow/cli performance benchmark \\
  --compare "$BASELINE_FILE" "$CURRENT_FILE" \\
  --threshold "$THRESHOLD"

rm "$CURRENT_FILE"
`,
    },
    'github-automation': {
      'pr-template': `#!/bin/bash
# GitHub Automation - PR Template Script
# Generate PR from template

set -e

TITLE="\${1:-Update}"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "Creating PR for branch: $BRANCH"

gh pr create \\
  --title "$TITLE" \\
  --body "$(cat <<EOF
## Summary
<!-- Describe your changes -->

## Test Plan
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Documentation updated
- [ ] No breaking changes

Generated with claude-flow
EOF
)"

echo "PR created successfully"
`,
      'release-prep': `#!/bin/bash
# GitHub Automation - Release Prep Script
# Prepare release with changelog

set -e

VERSION="\${1:-patch}"

echo "Preparing release..."

# Bump version
npm version "$VERSION" --no-git-tag-version

NEW_VERSION=$(node -p "require('./package.json').version")

echo "Creating release v$NEW_VERSION..."
gh release create "v$NEW_VERSION" \\
  --generate-notes \\
  --draft

echo "Draft release v$NEW_VERSION created"
`,
    },
  };

  const skillScripts = scripts[skillName];
  if (skillScripts && skillScripts[scriptName]) {
    return skillScripts[scriptName];
  }

  return `#!/bin/bash
# ${skillName} - ${scriptName}
# Generated by @claude-flow/codex

set -e

echo "Running ${scriptName}..."
# Add your script logic here
`;
}
