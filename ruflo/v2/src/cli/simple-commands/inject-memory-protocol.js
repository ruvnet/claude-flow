// inject-memory-protocol.js - Injects memory coordination protocol for swarms

import { existsSync } from 'fs';
import { promises as fs } from 'fs/promises';
import path from 'path';

/**
 * Memory coordination protocol to inject
 */
const MEMORY_PROTOCOL = `
## 🧠 MANDATORY MEMORY COORDINATION PROTOCOL

### 🚨 CRITICAL: Every Agent MUST Write AND Read Memory

**EVERY spawned agent MUST follow this exact pattern:**

\`\`\`javascript
// 1️⃣ IMMEDIATELY when agent starts - WRITE initial status
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/[agent-name]/status",
  namespace: "coordination",
  value: JSON.stringify({
    agent: "[agent-name]",
    status: "starting",
    timestamp: Date.now(),
    tasks: ["list", "of", "tasks"],
    progress: 0
  })
}

// 2️⃣ AFTER EACH MAJOR STEP - WRITE progress
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/[agent-name]/progress",
  namespace: "coordination",
  value: JSON.stringify({
    completed: ["task1", "task2"],
    current: "working on task3",
    progress: 35,
    files_created: ["file1.js"],
    interfaces: { "API": "definition" },
    dependencies_needed: []
  })
}

// 3️⃣ SHARE ARTIFACTS - WRITE for others
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/shared/[component]",
  namespace: "coordination",
  value: JSON.stringify({
    type: "interface",
    definition: "actual code here",
    created_by: "[agent-name]"
  })
}

// 4️⃣ CHECK DEPENDENCIES - READ then WAIT
const dep = mcp__claude-flow__memory_usage {
  action: "retrieve",
  key: "swarm/shared/[component]",
  namespace: "coordination"
}
if (!dep.found) {
  // Write waiting status
  mcp__claude-flow__memory_usage {
    action: "store",
    key: "swarm/[agent-name]/waiting",
    namespace: "coordination",
    value: JSON.stringify({
      waiting_for: "[component]",
      from: "[other-agent]"
    })
  }
}

// 5️⃣ SIGNAL COMPLETION
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/[agent-name]/complete",
  namespace: "coordination",
  value: JSON.stringify({
    status: "complete",
    deliverables: ["list"],
    integration_points: ["how to use"]
  })
}
\`\`\`

### 📊 MEMORY KEY STRUCTURE
- Use namespace: "coordination" ALWAYS
- Keys: swarm/[agent]/status|progress|waiting|complete
- Shared: swarm/shared/[component]

### ❌ COMMON MISTAKES
1. Only reading, never writing
2. Wrong namespace
3. No progress updates
4. Missing shared artifacts
`;

/**
 * Agent instruction template with memory requirements
 */
const AGENT_INSTRUCTION = `
🚨 MANDATORY MEMORY COORDINATION:

1. START - IMMEDIATELY write status:
   mcp__claude-flow__memory_usage { action: "store", key: "swarm/[your-name]/status", namespace: "coordination", value: {status: "starting"} }

2. PROGRESS - After EVERY major step:
   mcp__claude-flow__memory_usage { action: "store", key: "swarm/[your-name]/progress", namespace: "coordination", value: {progress: X%} }

3. SHARE - Write ALL interfaces/APIs:
   mcp__claude-flow__memory_usage { action: "store", key: "swarm/shared/[component]", namespace: "coordination", value: {definition: "..."} }

4. CHECK - Verify dependencies exist:
   mcp__claude-flow__memory_usage { action: "retrieve", key: "swarm/shared/[component]", namespace: "coordination" }

5. COMPLETE - Signal when done:
   mcp__claude-flow__memory_usage { action: "store", key: "swarm/[your-name]/complete", namespace: "coordination", value: {deliverables: [...]} }

REMEMBER: If you don't WRITE to memory, other agents can't coordinate with you!
`;

/**
 * Inject memory protocol into CLAUDE.md
 */
export async function injectMemoryProtocol(projectPath = process.cwd()) {
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  
  try {
    let content = '';
    let hasProtocol = false;
    
    // Check if CLAUDE.md exists
    if (existsSync(claudeMdPath)) {
      content = await fs.readFile(claudeMdPath, 'utf8');
      hasProtocol = content.includes('MANDATORY MEMORY COORDINATION PROTOCOL');
    }
    
    // If protocol not present, inject it
    if (!hasProtocol) {
      // Find a good injection point (after project overview or at start)
      const injectionPoint = content.indexOf('## Project Overview');
      
      if (injectionPoint > -1) {
        // Insert before Project Overview
        content = 
          content.slice(0, injectionPoint) + 
          MEMORY_PROTOCOL + '\n\n' +
          content.slice(injectionPoint);
      } else {
        // Prepend to file
        content = MEMORY_PROTOCOL + '\n\n' + content;
      }
      
      await fs.writeFile(claudeMdPath, content, 'utf8');
      console.log('✅ Injected memory coordination protocol into CLAUDE.md');
      return true;
    } else {
      console.log('✓ Memory coordination protocol already present in CLAUDE.md');
      return false;
    }
  } catch (error) {
    console.error('⚠️  Could not inject memory protocol:', error.message);
    return false;
  }
}

/**
 * Enhance swarm prompt with memory instructions
 */
export function enhanceSwarmPrompt(originalPrompt, agentCount = 5) {
  const enhancement = `
CRITICAL: ALL AGENTS MUST COORDINATE THROUGH MEMORY

${AGENT_INSTRUCTION}

Each of the ${agentCount} agents MUST:
- Write initial status when starting
- Update progress after each step (with %)
- Share all interfaces/APIs/configs
- Check dependencies before using
- Signal completion when done

ALL memory operations use namespace: "coordination"

Memory monitoring commands:
- Check status: memory search "swarm/*/status" --namespace coordination
- View progress: memory search "swarm/*/progress" --namespace coordination
- Find blockers: memory search "swarm/*/waiting" --namespace coordination
- List shared: memory search "swarm/shared/*" --namespace coordination

---
ORIGINAL OBJECTIVE:
${originalPrompt}`;

  return enhancement;
}

/**
 * Enhance hive-mind prompt with memory instructions
 */
export function enhanceHiveMindPrompt(originalPrompt, workers = []) {
  const workerInstructions = workers.map(w => 
    `Agent ${w.name}: MUST write to swarm/${w.name}/status and swarm/${w.name}/progress`
  ).join('\n');

  return `
HIVE MIND COORDINATION REQUIREMENTS:

${AGENT_INSTRUCTION}

${workerInstructions}

Coordination namespace: "coordination"
Status pattern: swarm/[agent]/status
Progress pattern: swarm/[agent]/progress  
Shared pattern: swarm/shared/[component]

---
ORIGINAL OBJECTIVE:
${originalPrompt}`;
}

/**
 * Check if memory protocol should be injected
 */
export function shouldInjectProtocol(flags) {
  return flags.claude || flags.spawn || flags['auto-spawn'];
}

export default {
  injectMemoryProtocol,
  enhanceSwarmPrompt,
  enhanceHiveMindPrompt,
  shouldInjectProtocol,
  MEMORY_PROTOCOL,
  AGENT_INSTRUCTION
};