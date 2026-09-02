// sparc-commands.js - SPARC-specific slash commands

// Create SPARC mode slash command
export function createSparcSlashCommand(mode) {
  // Extract the full description without truncation
  const fullDescription =
    mode.roleDefinition.length > 100
      ? `${mode.roleDefinition.substring(0, 97)}...`
      : mode.roleDefinition;

  return `---
name: sparc-${mode.slug}
description: ${mode.name} - ${fullDescription}
---

# ${mode.name}

## Role Definition
${mode.roleDefinition}

## Custom Instructions
${mode.customInstructions}

## Available Tools
${
  Array.isArray(mode.groups)
    ? mode.groups
        .map((g) => {
          if (typeof g === 'string') {
            return `- **${g}**: ${getToolDescription(g)}`;
          } else if (Array.isArray(g)) {
            return `- **${g[0]}**: ${g[1]?.description || getToolDescription(g[0])} ${g[1]?.fileRegex ? `(Files matching: ${g[1].fileRegex})` : ''}`;
          }
          return `- ${JSON.stringify(g)}`;
        })
        .join('\n')
    : 'None'
}

## Usage

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "${mode.slug}",
  task_description: "${getExampleTask(mode.slug)}",
  options: {
    namespace: "${mode.slug}",
    non_interactive: false
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run ${mode.slug} "${getExampleTask(mode.slug)}"

# For alpha features
npx claude-flow@alpha sparc run ${mode.slug} "${getExampleTask(mode.slug)}"

# With namespace
npx claude-flow@alpha sparc run ${mode.slug} "your task" --namespace ${mode.slug}

# Non-interactive mode
npx claude-flow@alpha sparc run ${mode.slug} "your task" --non-interactive
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run ${mode.slug} "${getExampleTask(mode.slug)}"
\`\`\`

## Memory Integration

### Using MCP Tools (Preferred)
\`\`\`javascript
// Store mode-specific context
mcp__claude-flow@alpha__memory_usage {
  action: "store",
  key: "${mode.slug}_context",
  value: "important decisions",
  namespace: "${mode.slug}"
}

// Query previous work
mcp__claude-flow@alpha__memory_search {
  pattern: "${mode.slug}",
  namespace: "${mode.slug}",
  limit: 5
}
\`\`\`

### Using NPX CLI (Fallback)
\`\`\`bash
# Store mode-specific context
npx claude-flow@alpha memory store "${mode.slug}_context" "important decisions" --namespace ${mode.slug}

# Query previous work
npx claude-flow@alpha memory query "${mode.slug}" --limit 5
\`\`\`
`;
}

// Helper function to get tool descriptions
function getToolDescription(tool) {
  const toolDescriptions = {
    read: 'File reading and viewing',
    edit: 'File modification and creation',
    browser: 'Web browsing capabilities',
    mcp: 'Model Context Protocol tools',
    command: 'Command execution',
  };
  return toolDescriptions[tool] || 'Tool access';
}

// Helper function to get example tasks
function getExampleTask(slug) {
  const examples = {
    architect: 'design microservices architecture',
    code: 'implement REST API endpoints',
    tdd: 'create user authentication tests',
    debug: 'fix memory leak in service',
    'security-review': 'audit API security',
    'docs-writer': 'create API documentation',
    integration: 'connect payment service',
    'post-deployment-monitoring-mode': 'monitor production metrics',
    'refinement-optimization-mode': 'optimize database queries',
    devops: 'deploy to AWS Lambda',
    'supabase-admin': 'create user authentication schema',
    'spec-pseudocode': 'define payment flow requirements',
    mcp: 'integrate with external API',
    swarm: 'build complete feature with tests',
    sparc: 'orchestrate authentication system',
    ask: 'help me choose the right mode',
    tutorial: 'guide me through SPARC methodology',
  };
  return examples[slug] || 'implement feature';
}

// Create main SPARC command
export function createMainSparcCommand(modes) {
  const modeList = modes.map((m) => `- \`/sparc-${m.slug}\` - ${m.name}`).join('\n');

  // Find the sparc orchestrator mode for its full description
  const sparcMode = modes.find((m) => m.slug === 'sparc');
  const sparcDescription = sparcMode
    ? sparcMode.roleDefinition
    : 'SPARC orchestrator for complex workflows';
  const sparcInstructions = sparcMode ? sparcMode.customInstructions : '';

  return `---
name: sparc
description: Execute SPARC methodology workflows with Claude-Flow
---

# ⚡️ SPARC Development Methodology

${sparcDescription}

## SPARC Workflow

${sparcInstructions.split('\n').slice(0, 10).join('\n')}

## Available SPARC Modes

${modeList}

## Quick Start

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
// Run SPARC orchestrator (default)
mcp__claude-flow@alpha__sparc_mode {
  mode: "sparc",
  task_description: "build complete authentication system"
}

// Run a specific mode
mcp__claude-flow@alpha__sparc_mode {
  mode: "architect",
  task_description: "design API structure"
}

// TDD workflow
mcp__claude-flow@alpha__sparc_mode {
  mode: "tdd",
  task_description: "implement user authentication",
  options: {workflow: "full"}
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Run SPARC orchestrator (default)
npx claude-flow@alpha sparc "build complete authentication system"

# Run a specific mode
npx claude-flow@alpha sparc run architect "design API structure"
npx claude-flow@alpha sparc run tdd "implement user service"

# Execute full TDD workflow
npx claude-flow@alpha sparc tdd "implement user authentication"

# List all modes with details
npx claude-flow@alpha sparc modes --verbose

# For alpha features
npx claude-flow@alpha sparc run <mode> "your task"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc "build complete authentication system"
./claude-flow@alpha sparc run architect "design API structure"
\`\`\`

## SPARC Methodology Phases

1. **📋 Specification**: Define requirements, constraints, and acceptance criteria
2. **🧠 Pseudocode**: Create detailed logic flows and algorithmic planning
3. **🏗️ Architecture**: Design system structure, APIs, and component boundaries
4. **🔄 Refinement**: Implement with TDD (Red-Green-Refactor cycle)
5. **✅ Completion**: Integrate, document, and validate against requirements

## Memory Integration

### Using MCP Tools (Preferred)
\`\`\`javascript
// Store specifications
mcp__claude-flow@alpha__memory_usage {
  action: "store",
  key: "spec_auth",
  value: "OAuth2 + JWT requirements",
  namespace: "spec"
}

// Store architectural decisions
mcp__claude-flow@alpha__memory_usage {
  action: "store",
  key: "arch_decisions",
  value: "Microservices with API Gateway",
  namespace: "architecture"
}
\`\`\`

### Using NPX CLI (Fallback)
\`\`\`bash
# Store specifications
npx claude-flow@alpha memory store "spec_auth" "OAuth2 + JWT requirements" --namespace spec

# Store architectural decisions
./claude-flow@alpha memory store "arch_api" "RESTful microservices design" --namespace arch

# Query previous work
./claude-flow@alpha memory query "authentication" --limit 10

# Export project memory
./claude-flow@alpha memory export sparc-project-backup.json
\`\`\`

## Advanced Swarm Mode

For complex tasks requiring multiple agents with timeout-free execution:
\`\`\`bash
# Development swarm with monitoring
./claude-flow@alpha swarm "Build e-commerce platform" --strategy development --monitor --review

# Background optimization swarm
./claude-flow@alpha swarm "Optimize system performance" --strategy optimization --background

# Distributed research swarm
./claude-flow@alpha swarm "Analyze market trends" --strategy research --distributed --ui
\`\`\`

## Non-Interactive Mode

For CI/CD integration and automation:
\`\`\`bash
./claude-flow@alpha sparc run code "implement API" --non-interactive
./claude-flow@alpha sparc tdd "user tests" --non-interactive --enable-permissions
\`\`\`

## Best Practices

✅ **Modular Design**: Keep files under 500 lines
✅ **Environment Safety**: Never hardcode secrets or env values
✅ **Test-First**: Always write tests before implementation
✅ **Memory Usage**: Store important decisions and context
✅ **Task Completion**: All tasks should end with \`attempt_completion\`

See \`/claude-flow@alpha-help\` for all available commands.
`;
}
