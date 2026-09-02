// index.js - SPARC mode orchestration loader
import { getArchitectOrchestration } from './architect.js';
import { getCodeOrchestration } from './code.js';
import { getTddOrchestration } from './tdd.js';
import { getDebugOrchestration } from './debug.js';
import { getSecurityReviewOrchestration } from './security-review.js';
import { getDocsWriterOrchestration } from './docs-writer.js';
import { getIntegrationOrchestration } from './integration.js';
import { getMonitoringOrchestration } from './monitoring.js';
import { getOptimizationOrchestration } from './optimization.js';
import { getSupabaseAdminOrchestration } from './supabase-admin.js';
import { getSpecPseudocodeOrchestration } from './spec-pseudocode.js';
import { getMcpOrchestration } from './mcp.js';
import { getDevOpsOrchestration } from './devops.js';
import { getAskOrchestration } from './ask.js';
import { getTutorialOrchestration } from './tutorial.js';
import { getSparcOrchestratorOrchestration } from './sparc-orchestrator.js';
import { getGenericOrchestration } from './generic.js';
import { getSwarmOrchestration } from './swarm.js';

// Mode orchestration mapping
const modeOrchestrations = {
  architect: getArchitectOrchestration,
  code: getCodeOrchestration,
  tdd: getTddOrchestration,
  debug: getDebugOrchestration,
  'security-review': getSecurityReviewOrchestration,
  'docs-writer': getDocsWriterOrchestration,
  integration: getIntegrationOrchestration,
  'post-deployment-monitoring-mode': getMonitoringOrchestration,
  'refinement-optimization-mode': getOptimizationOrchestration,
  'supabase-admin': getSupabaseAdminOrchestration,
  'spec-pseudocode': getSpecPseudocodeOrchestration,
  mcp: getMcpOrchestration,
  devops: getDevOpsOrchestration,
  ask: getAskOrchestration,
  tutorial: getTutorialOrchestration,
  sparc: getSparcOrchestratorOrchestration,
  swarm: getSwarmOrchestration,
};

/**
 * Get orchestration template for a specific mode
 * @param {string} modeSlug - The mode slug identifier
 * @param {string} taskDescription - The task description
 * @param {string} memoryNamespace - The memory namespace
 * @returns {string} The orchestration template
 */
export function getModeOrchestration(modeSlug, taskDescription, memoryNamespace) {
  const orchestrationFunction = modeOrchestrations[modeSlug];

  if (orchestrationFunction) {
    return orchestrationFunction(taskDescription, memoryNamespace);
  }

  // Return generic orchestration for unknown modes
  return getGenericOrchestration(taskDescription, memoryNamespace);
}

/**
 * Get the base SPARC prompt template
 * @param {Object} mode - The mode configuration
 * @param {string} taskDescription - The task description
 * @param {string} memoryNamespace - The memory namespace
 * @returns {string} The complete SPARC prompt
 */
export function createSparcPrompt(mode, taskDescription, memoryNamespace) {
  const orchestration = getModeOrchestration(mode.slug, taskDescription, memoryNamespace);
  // Get the actual working directory where the command was run from
  const cwd = process.env.PWD || process.cwd();

  return `# ${mode.name} - Task Execution

## 🎯 Your Mission
Build exactly what the user requested: "${taskDescription}"

## 📁 IMPORTANT: Project Directory
**Current Working Directory:** ${cwd}

⚠️ **CRITICAL INSTRUCTIONS:**
- Create ALL project files in the current working directory: ${cwd}
- NEVER create files in node_modules/ or any claude-flow directories
- If the task specifies a project name (e.g., "hello-world"), create it as a subdirectory in ${cwd}
- Use paths relative to ${cwd} for all file operations
- Example: If creating "hello-world" app, use ${cwd}/hello-world/

## 🚀 Your Role
${mode.roleDefinition}

${orchestration}

## 📋 Mode-Specific Guidelines
${mode.customInstructions}

## 🛠️ Claude-Flow Integration

### Memory Operations
Use the memory system to track your progress and share context:

\`\`\`bash
# Store your work
npx claude-flow memory store ${memoryNamespace}_<phase> "description of work completed"

# Query previous work
npx claude-flow memory query ${memoryNamespace}

# Examples for this task
npx claude-flow memory store ${memoryNamespace}_analysis "Analyzed ${taskDescription} - found X components needed"
npx claude-flow memory store ${memoryNamespace}_progress "Completed Y% of implementation"
npx claude-flow memory store ${memoryNamespace}_blockers "Issue with Z - need clarification"
\`\`\`

### Task Orchestration
For complex tasks, coordinate with other specialists:

\`\`\`bash
# Check system status
npx claude-flow status

# View active agents (if --parallel was used)
npx claude-flow agent list

# Monitor progress
npx claude-flow monitor
\`\`\`

### 🚀 Parallel Execution with BatchTool
Use BatchTool to orchestrate multiple SPARC modes concurrently in a boomerang pattern:

\`\`\`bash
# Example: Parallel development workflow
batchtool run --parallel \\
  "npx claude-flow sparc run architect 'design user authentication system' --non-interactive" \\
  "npx claude-flow sparc run security-review 'analyze authentication requirements' --non-interactive" \\
  "npx claude-flow sparc run spec-pseudocode 'create auth flow pseudocode' --non-interactive"

# Boomerang Pattern: Research → Design → Implement → Test → Refine
batchtool orchestrate --boomerang \\
  --phase1 "npx claude-flow sparc run ask 'research best auth practices' --non-interactive" \\
  --phase2 "npx claude-flow sparc run architect 'design based on research' --non-interactive" \\
  --phase3 "npx claude-flow sparc run code 'implement auth system' --non-interactive" \\
  --phase4 "npx claude-flow sparc run tdd 'test auth implementation' --non-interactive" \\
  --phase5 "npx claude-flow sparc run optimization 'refine auth performance' --non-interactive"

# Concurrent Feature Development
batchtool run --concurrent --max-parallel 3 \\
  "npx claude-flow sparc run code 'implement login feature' --non-interactive" \\
  "npx claude-flow sparc run code 'implement registration feature' --non-interactive" \\
  "npx claude-flow sparc run code 'implement password reset' --non-interactive" \\
  "npx claude-flow sparc run tdd 'create auth test suite' --non-interactive"
\`\`\`

#### Boomerang Orchestration Pattern
The boomerang pattern allows for iterative development where results from one phase inform the next:
1. **Research Phase**: Gather requirements and best practices
2. **Design Phase**: Create architecture based on research
3. **Implementation Phase**: Build according to design
4. **Testing Phase**: Validate implementation
5. **Refinement Phase**: Optimize based on test results
6. **Loop Back**: Results feed back to improve the cycle

Benefits of --non-interactive mode with BatchTool:
- No manual intervention required
- Parallel execution of independent tasks
- Automatic result collection and aggregation
- Progress tracking across all concurrent operations
- Efficient resource utilization

## ⚡ Execution Guidelines

1. **Focus on User's Project**
   - Build what they asked for, not improvements to claude-flow
   - Create files ONLY in the current working directory: ${cwd}
   - NEVER create files in node_modules/ or system directories
   - If creating a named project, make it a subdirectory of ${cwd}
   - Use appropriate project structure relative to ${cwd}

2. **Directory Rules**
   - Current directory: ${cwd}
   - Create new projects as: ${cwd}/<project-name>/
   - Use relative paths from ${cwd} for all operations
   - Verify you're in the correct directory before creating files

3. **Quality Standards**
   - Keep all files under 500 lines
   - Never hardcode secrets or credentials
   - Use environment variables and config files
   - Write clean, maintainable code

4. **Communication**
   - Store progress updates in memory
   - Document key decisions
   - Ask for clarification if needed
   - Provide clear status updates

## 🏁 Start Execution

Begin with Step 1 of the orchestration plan above. Focus on delivering exactly what was requested: "${taskDescription}"

Remember: You're building the user's project, using claude-flow only for memory and orchestration support.`;
}
