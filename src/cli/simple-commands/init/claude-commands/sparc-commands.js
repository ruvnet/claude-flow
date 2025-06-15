// sparc-commands.js - SPARC-specific slash commands

// Create SPARC mode slash command
export function createSparcSlashCommand(mode) {
  // Extract the full description without truncation
  const fullDescription = mode.roleDefinition.length > 100 
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
${Array.isArray(mode.groups) ? mode.groups.map(g => {
  if (typeof g === 'string') {
    return `- **${g}**: ${getToolDescription(g)}`;
  } else if (Array.isArray(g)) {
    return `- **${g[0]}**: ${g[1]?.description || getToolDescription(g[0])} ${g[1]?.fileRegex ? `(Files matching: ${g[1].fileRegex})` : ''}`;
  }
  return `- ${JSON.stringify(g)}`;
}).join('\n') : 'None'}

## Usage

To use this SPARC mode, you can:

1. **Run directly**: \`./claude-flow sparc run ${mode.slug} "your task"\`
2. **TDD shorthand** (if applicable): \`./claude-flow sparc ${mode.slug} "your task"\`
3. **Use in workflow**: Include \`${mode.slug}\` in your SPARC workflow
4. **Delegate tasks**: Use \`new_task\` to assign work to this mode

## Example Commands

\`\`\`bash
# Run this specific mode
./claude-flow sparc run ${mode.slug} "${getExampleTask(mode.slug)}"

# Use with memory namespace
./claude-flow sparc run ${mode.slug} "your task" --namespace ${mode.slug}

# Non-interactive mode for automation
./claude-flow sparc run ${mode.slug} "your task" --non-interactive
\`\`\`

## Memory Integration

\`\`\`bash
# Store mode-specific context
./claude-flow memory store "${mode.slug}_context" "important decisions" --namespace ${mode.slug}

# Query previous work
./claude-flow memory query "${mode.slug}" --limit 5
\`\`\`
`;
}

// Helper function to get tool descriptions
function getToolDescription(tool) {
  const toolDescriptions = {
    'read': 'File reading and viewing',
    'edit': 'File modification and creation',
    'browser': 'Web browsing capabilities',
    'mcp': 'Model Context Protocol tools',
    'command': 'Command execution'
  };
  return toolDescriptions[tool] || 'Tool access';
}

// Helper function to get example tasks
function getExampleTask(slug) {
  const examples = {
    'architect': 'design microservices architecture',
    'code': 'implement REST API endpoints',
    'tdd': 'create user authentication tests',
    'debug': 'fix memory leak in service',
    'security-review': 'audit API security',
    'docs-writer': 'create API documentation',
    'integration': 'connect payment service',
    'post-deployment-monitoring-mode': 'monitor production metrics',
    'refinement-optimization-mode': 'optimize database queries',
    'devops': 'deploy to AWS Lambda',
    'supabase-admin': 'create user authentication schema',
    'spec-pseudocode': 'define payment flow requirements',
    'mcp': 'integrate with external API',
    'swarm': 'build complete feature with tests',
    'sparc': 'orchestrate authentication system',
    'ask': 'help me choose the right mode',
    'tutorial': 'guide me through SPARC methodology'
  };
  return examples[slug] || 'implement feature';
}

// Create main SPARC command
export function createMainSparcCommand(modes) {
  const modeList = modes.map(m => `- \`/sparc-${m.slug}\` - ${m.name}`).join('\n');
  
  // Find the sparc orchestrator mode for its full description
  const sparcMode = modes.find(m => m.slug === 'sparc');
  const sparcDescription = sparcMode ? sparcMode.roleDefinition : 'SPARC orchestrator for complex workflows';
  const sparcInstructions = sparcMode && sparcMode.customInstructions ? sparcMode.customInstructions : '';
  
  // Handle empty instructions
  const instructionSection = sparcInstructions ? 
    `## SPARC Workflow\n\n${sparcInstructions.split('\n').slice(0, 10).join('\n')}\n\n` : '';
  
  return `---
name: sparc
description: Execute SPARC methodology workflows with Claude-Flow
---

# ⚡️ SPARC Development Methodology

${sparcDescription}

${instructionSection}

## Available SPARC Modes

${modeList}

## Quick Start

### Run SPARC orchestrator (default):
\`\`\`bash
./claude-flow sparc "build complete authentication system"
\`\`\`

### Run a specific mode:
\`\`\`bash
./claude-flow sparc run <mode> "your task"
./claude-flow sparc run architect "design API structure"
./claude-flow sparc run tdd "implement user service"
\`\`\`

### Execute full TDD workflow:
\`\`\`bash
./claude-flow sparc tdd "implement user authentication"
\`\`\`

### List all modes with details:
\`\`\`bash
./claude-flow sparc modes --verbose
\`\`\`

## SPARC Methodology Phases

1. **📋 Specification**: Define requirements, constraints, and acceptance criteria
2. **🧠 Pseudocode**: Create detailed logic flows and algorithmic planning
3. **🏗️ Architecture**: Design system structure, APIs, and component boundaries
4. **🔄 Refinement**: Implement with TDD (Red-Green-Refactor cycle)
5. **✅ Completion**: Integrate, document, and validate against requirements

## Memory Integration

Use memory commands to persist context across SPARC sessions:
\`\`\`bash
# Store specifications
./claude-flow memory store "spec_auth" "OAuth2 + JWT requirements" --namespace spec

# Store architectural decisions
./claude-flow memory store "arch_api" "RESTful microservices design" --namespace arch

# Query previous work
./claude-flow memory query "authentication" --limit 10

# Export project memory
./claude-flow memory export sparc-project-backup.json
\`\`\`

## Advanced Swarm Mode

For complex tasks requiring multiple agents with timeout-free execution:
\`\`\`bash
# Development swarm with monitoring
./claude-flow swarm "Build e-commerce platform" --strategy development --monitor --review

# Background optimization swarm
./claude-flow swarm "Optimize system performance" --strategy optimization --background

# Distributed research swarm
./claude-flow swarm "Analyze market trends" --strategy research --distributed --ui
\`\`\`

## Non-Interactive Mode

For CI/CD integration and automation:
\`\`\`bash
./claude-flow sparc run code "implement API" --non-interactive
./claude-flow sparc tdd "user tests" --non-interactive --enable-permissions
\`\`\`

## Best Practices

✅ **Modular Design**: Keep files under 500 lines
✅ **Environment Safety**: Never hardcode secrets or env values
✅ **Test-First**: Always write tests before implementation
✅ **Memory Usage**: Store important decisions and context
✅ **Task Completion**: All tasks should end with \`attempt_completion\`

See \`/claude-flow-help\` for all available commands.
`;
}