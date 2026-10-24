// verification-claude-md.js - Verification and Pair Programming CLAUDE.md template

export function createVerificationClaudeMd() {
  return `# Claude Code Configuration - Truth Verification & Pair Programming Environment

## 🔍 VERIFICATION-FIRST DEVELOPMENT

This project enforces **"truth is enforced, not assumed"** with mandatory verification for all operations.

### 🎯 Truth Verification System Active
- **Threshold**: 0.95 (95% accuracy required)
- **Mode**: Strict verification with auto-rollback
- **Pair Programming**: Real-time collaborative development
- **Background Monitoring**: Continuous validation enabled

## 🚨 CRITICAL: VERIFICATION COMMANDS

### Initialize Verification System
\`\`\`bash
# Set verification mode (strict/moderate/development)
./claude-flow verify init strict     # 95% threshold, auto-rollback
./claude-flow verify init moderate   # 85% threshold, no auto-rollback
./claude-flow verify init development # 75% threshold, for prototyping
\`\`\`

### Run Verification
\`\`\`bash
# Verify specific tasks
./claude-flow verify verify task-123 --agent coder
./claude-flow verify verify task-456 --agent reviewer --threshold 0.90

# Check truth scores
./claude-flow truth                  # View current truth scores
./claude-flow truth --report         # Generate detailed report
./claude-flow truth --analyze        # Analyze failure patterns
\`\`\`

### Pair Programming Mode
\`\`\`bash
# Start pair programming with real-time verification
./claude-flow pair --start           # Begin collaborative session
./claude-flow pair --start --mode strict  # Production-quality pairing
./claude-flow pair --verify --threshold 0.90  # Custom threshold

# Background monitoring (use run_in_background: true)
./claude-flow pair --start --monitor # Continuous monitoring dashboard
\`\`\`

## 📊 VERIFICATION REQUIREMENTS BY AGENT TYPE

### Coder Agents
- **Compile**: Code must compile without errors (35% weight)
- **Test**: All tests must pass (25% weight)
- **Lint**: Code quality checks (20% weight)
- **Typecheck**: Type safety verification (20% weight)

### Reviewer Agents
- **Code Analysis**: Static code analysis
- **Security Scan**: Vulnerability detection
- **Performance Check**: Regression testing

### Tester Agents
- **Unit Tests**: Component-level testing
- **Integration Tests**: System-wide validation
- **Coverage Check**: Minimum coverage thresholds

### Planner Agents
- **Task Decomposition**: Valid task breakdown
- **Dependency Check**: Dependency validation
- **Feasibility**: Resource analysis

## 🔄 BACKGROUND TASK MANAGEMENT

### Running Verification in Background
\`\`\`javascript
// Use run_in_background parameter for continuous monitoring
{
  "tool": "Bash",
  "command": "./claude-flow pair --start --monitor",
  "run_in_background": true  // Enables background execution
}
\`\`\`

### Managing Background Tasks
\`\`\`bash
# Interactive management
/bashes                      # View all background tasks

# Check specific verification task
"Check status of bash_1"     # Via prompt to Claude

# Monitor verification output
"Show output from bash_1"    # Real-time monitoring

# Kill verification session
"Kill bash_1"                # Stop background verification
\`\`\`

## 🚨 CRITICAL: CONCURRENT VERIFICATION

**MANDATORY**: All verification operations MUST be concurrent:

### ✅ CORRECT - Parallel Verification
\`\`\`javascript
[Single Message]:
  // Initialize verification for multiple tasks
  - Bash("./claude-flow verify verify task-1 --agent coder")
  - Bash("./claude-flow verify verify task-2 --agent reviewer")
  - Bash("./claude-flow verify verify task-3 --agent tester")
  
  // Check all truth scores
  - Bash("./claude-flow truth --json")
  
  // Start monitoring in background
  - Bash("./claude-flow pair --start --monitor", run_in_background: true)
\`\`\`

### ❌ WRONG - Sequential Verification
\`\`\`javascript
Message 1: Verify task-1
Message 2: Verify task-2
Message 3: Check truth score
// This is 3x slower!
\`\`\`

## 📈 VERIFICATION METRICS & THRESHOLDS

### Target Metrics
- **Truth Accuracy Rate**: >95%
- **Integration Success Rate**: >90%
- **Automated Rollback Frequency**: <5%
- **Human Intervention Rate**: <10%

### Verification Modes
| Mode | Threshold | Auto-Rollback | Use Case |
|------|-----------|---------------|----------|
| **Strict** | 0.95 | ✅ Enabled | Production |
| **Moderate** | 0.85 | ❌ Disabled | Development |
| **Development** | 0.75 | ❌ Disabled | Prototyping |

## 🤝 PAIR PROGRAMMING WORKFLOW

### 1. Start Session
\`\`\`bash
# Initialize pair programming with verification
./claude-flow pair --start --mode strict
\`\`\`

### 2. Real-time Verification Cycle
\`\`\`
Developer writes code
    ↓
AI agent reviews in real-time
    ↓
Verification engine checks:
  - Compilation (35%)
  - Tests (25%)
  - Linting (20%)
  - Type safety (20%)
    ↓
Truth score calculated
    ↓
Pass (>0.95) → Accept change
Fail (<0.95) → Suggest fixes or rollback
\`\`\`

### 3. Continuous Monitoring
\`\`\`bash
# Monitor in background
./claude-flow pair --start --monitor &

# Check verification output
/bashes  # Interactive view
"Check bash_1 output"  # Via prompt
\`\`\`

## 🔒 SECURITY & AUDIT FEATURES

### Cryptographic Verification
- All verification results are cryptographically signed
- SHA256 checksums for integrity
- Immutable audit trail

### Byzantine Fault Tolerance
- Protection against incorrect agents
- Consensus requirements (2/3+ majority)
- Automatic agent quarantine

### Audit Trail
\`\`\`bash
# View verification history
cat .swarm/verification-memory.json | jq .history

# Check agent reliability
./claude-flow truth --agent coder --detailed
\`\`\`

## 🚀 QUICK START VERIFICATION WORKFLOW

### Step 1: Initialize Project with Verification
\`\`\`bash
# Initialize with verification-first approach
npx claude-flow@alpha init --verify --pair

# Set up strict verification
./claude-flow verify init strict
\`\`\`

### Step 2: Start Development with Pair Programming
\`\`\`bash
# Start pair programming session
./claude-flow pair --start --mode strict --monitor &

# Monitor verification (background task)
/bashes  # Check bash_1 status
\`\`\`

### Step 3: Develop with Continuous Verification
\`\`\`bash
# All changes are automatically verified
# Truth scores maintained above 0.95
# Auto-rollback on verification failures
\`\`\`

### Step 4: Check Truth Metrics
\`\`\`bash
# View current truth scores
./claude-flow truth

# Generate detailed report
./claude-flow truth --report --export metrics.json
\`\`\`

## 📋 VERIFICATION CHECKLIST

Before ANY operation:
- ✅ Is verification system initialized?
- ✅ Is pair programming mode active?
- ✅ Are background monitors running?
- ✅ Is truth threshold configured correctly?
- ✅ Are all agents configured for verification?

## 🛠️ BUILD COMMANDS WITH VERIFICATION

### Standard Commands (with verification)
- \`npm run build\`: Build with verification checks
- \`npm run test\`: Test with truth scoring
- \`npm run lint\`: Lint with verification tracking
- \`npm run typecheck\`: Type check with validation

### Verification Commands
- \`./claude-flow verify status\`: Check system status
- \`./claude-flow verify verify <task>\`: Run verification
- \`./claude-flow truth\`: View truth scores
- \`./claude-flow pair --start\`: Begin pair programming

## 💾 PERSISTENT VERIFICATION MEMORY

Verification data stored in:
- \`.swarm/verification-memory.json\`: Verification history
- \`.swarm/memory.db\`: Persistent swarm memory
- \`.claude/verification-config.json\`: Custom configuration

## 🎯 AGENT VERIFICATION PATTERNS

### Full-Stack Development with Verification
\`\`\`javascript
// Deploy agents with verification requirements
Task("System architecture", "Design with verification", "system-architect")
Task("Backend APIs", "Implement with 95% accuracy", "backend-dev")
Task("Frontend", "Build with validation", "mobile-dev")
Task("Testing", "Comprehensive verification", "tester")
Task("Review", "Verify all changes", "reviewer")
\`\`\`

### Verification-First TDD
\`\`\`javascript
// TDD with mandatory verification
Task("Write failing tests", "Verify test quality", "tester")
Task("Implement code", "Verify implementation", "coder")
Task("Refactor", "Verify improvements", "reviewer")
Task("Validate", "Final verification", "production-validator")
\`\`\`

## ⚡ PERFORMANCE WITH VERIFICATION

### Optimized Verification
- **Parallel Checks**: Run all verifications concurrently
- **Cached Results**: Skip unchanged file verification
- **Smart Batching**: Group related verifications
- **Background Execution**: Non-blocking verification

### Expected Performance
- Verification overhead: <10% for most operations
- Truth score calculation: <500ms
- Rollback execution: <2 seconds
- Background monitoring: Minimal impact

## 🔄 AUTOMATED WORKFLOWS

### CI/CD Integration
\`\`\`yaml
# .github/workflows/verification.yml
- name: Run Verification
  run: |
    npx claude-flow verify init strict
    npx claude-flow verify verify \${{ github.run_id }}
    npx claude-flow truth --threshold 0.95
\`\`\`

### Pre-commit Hooks
\`\`\`bash
# .git/hooks/pre-commit
#!/bin/bash
npx claude-flow verify verify pre-commit --agent coder
SCORE=\$(npx claude-flow truth --json | jq .averageScore)
if [ "\$SCORE" -lt "0.85" ]; then
  echo "❌ Commit blocked: Truth score \$SCORE below threshold"
  exit 1
fi
\`\`\`

## 📚 DOCUMENTATION

- [Truth Verification System](https://github.com/ruvnet/claude-flow/wiki/Truth-Verification-System)
- [Pair Programming Guide](https://github.com/ruvnet/claude-flow/wiki/Pair-Programming-System)
- [Background Commands](https://github.com/ruvnet/claude-flow/wiki/background-commands)
- [Agent Verification](https://github.com/ruvnet/claude-flow/wiki/Agent-Verification)

## 🚨 IMPORTANT REMINDERS

1. **Truth is Enforced**: Every operation requires verification
2. **Parallel Execution**: All verifications run concurrently
3. **Background Monitoring**: Use run_in_background for continuous checks
4. **Persistent Memory**: All verification data is saved
5. **Auto-Rollback**: Failed verifications trigger automatic recovery

---

Remember: **"Truth is enforced, not assumed"** - All operations require verification!
`;
}

export function createVerificationSettingsJson() {
  return JSON.stringify({
    "version": "1.0.0",
    "verification": {
      "enabled": true,
      "mode": "strict",
      "threshold": 0.95,
      "autoRollback": true,
      "requireConsensus": true
    },
    "pairProgramming": {
      "enabled": true,
      "mode": "strict",
      "realTimeVerification": true,
      "continuousMonitoring": true,
      "backgroundExecution": true
    },
    "agentVerification": {
      "coder": {
        "checks": ["compile", "test", "lint", "typecheck"],
        "weights": {
          "compile": 0.35,
          "test": 0.25,
          "lint": 0.20,
          "typecheck": 0.20
        }
      },
      "reviewer": {
        "checks": ["code-analysis", "security-scan", "performance-check"],
        "weights": {
          "code-analysis": 0.40,
          "security-scan": 0.35,
          "performance-check": 0.25
        }
      },
      "tester": {
        "checks": ["unit-tests", "integration-tests", "coverage-check"],
        "weights": {
          "unit-tests": 0.35,
          "integration-tests": 0.35,
          "coverage-check": 0.30
        }
      },
      "planner": {
        "checks": ["task-decomposition", "dependency-check", "feasibility"],
        "weights": {
          "task-decomposition": 0.40,
          "dependency-check": 0.30,
          "feasibility": 0.30
        }
      }
    },
    "backgroundTasks": {
      "autoBackground": {
        "enabled": true,
        "patterns": [
          "./claude-flow pair --start",
          "./claude-flow verify verify",
          "./claude-flow truth --monitor",
          "*--monitor*",
          "*--watch*"
        ]
      }
    },
    "metrics": {
      "targets": {
        "truthAccuracy": 0.95,
        "integrationSuccess": 0.90,
        "rollbackFrequency": 0.05,
        "humanIntervention": 0.10
      }
    },
    "hooks": {
      "pre-commit": {
        "enabled": true,
        "commands": [
          "npx claude-flow verify verify pre-commit --agent coder"
        ],
        "threshold": 0.85
      },
      "post-task": {
        "enabled": true,
        "commands": [
          "npx claude-flow truth --json",
          "npx claude-flow verify status"
        ]
      }
    }
  }, null, 2);
}