# Claude Code Configuration - Truth-Verified Development

## 🛡️ Verification & Truth Scoring System

### Status: [ENABLED/DISABLED]
Current Mode: **PASSIVE** | Truth Threshold: **0.80**

### Quick Enable
```bash
# Enable verification (non-breaking, opt-in)
npx claude-flow verify --enable

# Set verification mode
npx claude-flow verify --mode strict  # passive|active|strict

# Set truth threshold
npx claude-flow verify --threshold 0.95
```

## 🎯 Truth Scoring Integration

### How It Works
Every agent action is automatically scored for truthfulness:
- **Claims** vs **Reality** comparison
- **Evidence-based** scoring (tests, lint, types, build)
- **Persistent memory** tracking
- **Historical reliability** calculation

### Check Truth Scores
```bash
# Current agent score
npx claude-flow truth score [agent-id]

# Agent reliability over time
npx claude-flow truth reliability [agent-id]

# Full truth report
npx claude-flow truth report --format markdown
```

## 🚨 CRITICAL: Concurrent Execution Rules

**WITH VERIFICATION**: All operations remain concurrent with truth scoring

### Verified Batch Operations
```javascript
// Everything in ONE message with verification
[Single Message]:
  - TodoWrite { todos: [10+ todos], verify: true }
  - Task("Agent 1", { verify: true }), Task("Agent 2", { verify: true })
  - Read + Verify, Write + Verify, Edit + Verify
  - Bash("npm test") + Truth Score
```

## 🤖 Agent Verification Hooks

### Each Agent Now Includes:
```javascript
{
  type: "coder",
  verification: {
    pre_task: "snapshot + baseline tests",
    during_task: "incremental validation",
    post_task: "truth score calculation",
    on_claim: "evidence gathering"
  }
}
```

### Verification-Enhanced Agents (54 Total)
All existing agents now support optional verification:

| Agent | Truth Features |
|-------|---------------|
| coder | Code compilation + test verification |
| reviewer | Claim validation + cross-checking |
| tester | Test execution + coverage truth |
| planner | Feasibility verification |
| production-validator | Real deployment verification |

## 📦 NPX Commands with Verification

### Standard Commands (Backward Compatible)
```bash
# Works exactly as before
npx claude-flow sparc run dev "build feature"

# Add --verify for truth scoring
npx claude-flow sparc run dev "build feature" --verify

# Set verification level
npx claude-flow sparc run dev "build feature" --verify=strict
```

### New Verification Commands
```bash
# Verification control
npx claude-flow verify --enable                # Enable system
npx claude-flow verify --status                # Check status
npx claude-flow verify --mode [passive|active|strict]  # Set mode
npx claude-flow verify --threshold 0.95        # Set threshold

# Truth scoring
npx claude-flow truth score [agent-id]         # Get score
npx claude-flow truth history [agent-id]       # View history
npx claude-flow truth reliability [agent-id]   # Check reliability
npx claude-flow truth report                   # Generate report

# Checkpoints & rollback
npx claude-flow checkpoint create              # Manual checkpoint
npx claude-flow checkpoint list                # List checkpoints
npx claude-flow rollback [checkpoint-id]       # Rollback to checkpoint
```

## 🔧 MCP Tool Integration

### Enhanced MCP Tools (Backward Compatible)
```javascript
// Existing tools work as before
mcp__claude-flow__swarm_init { topology: "mesh" }

// Add verification (optional)
mcp__claude-flow__swarm_init { 
  topology: "mesh",
  verification: { enabled: true, mode: "strict" }
}

// New verification-specific tools
mcp__claude-flow__truth_score {
  agent_id: "coder-1",
  claim: "All tests pass",
  evidence: { test_results: {...} }
}

mcp__claude-flow__verify_handoff {
  from_agent: "coder-1",
  to_agent: "tester-1",
  require_acceptance: true
}
```

## 💾 Memory-Based Truth Persistence

### Automatic Storage
```
.claude-flow/memory/truth-scores/
├── coder-1_task-123_1234567890.json
├── tester-1_task-124_1234567891.json
└── reviewer-1_task-125_1234567892.json
```

### Memory Integration
```javascript
// Truth scores automatically stored via memory_usage
mcp__claude-flow__memory_usage {
  action: "store",
  namespace: "truth_scores",
  key: "agent_task_score",
  value: { score: 0.95, evidence: {...} },
  truth_metadata: { verified: true }  // NEW
}
```

## 📊 Verification Modes

### Passive Mode (Default)
- Logs truth scores
- No enforcement
- Zero performance impact
- Good for initial adoption

### Active Mode
- Warns on low scores
- Highlights discrepancies
- Suggests improvements
- Non-blocking

### Strict Mode
- Blocks on verification failure
- Automatic rollback
- Requires 95%+ truth score
- Maximum reliability

## 🔄 Progressive Adoption

### Phase 1: Start Passive
```bash
npx claude-flow verify --enable --mode passive
# Monitor truth scores without disruption
```

### Phase 2: Active Warning
```bash
npx claude-flow verify --mode active
# Get warnings but continue working
```

### Phase 3: Strict Enforcement
```bash
npx claude-flow verify --mode strict --threshold 0.95
# Full verification with rollback
```

## 📈 Monitoring & Metrics

### Dashboard
```bash
npx claude-flow dashboard --verification
```

Shows:
- Truth scores by agent
- Verification success rate
- Rollback frequency
- Performance impact
- Reliability trends

### Reports
```bash
# Generate truth report
npx claude-flow truth report --format markdown > truth-report.md

# CI/CD integration
npx claude-flow truth report --format json | jq '.agents'
```

## 🔗 GitHub Integration

### GitHub Actions
```yaml
- name: Run with Verification
  run: |
    npx claude-flow@alpha verify --enable
    npx claude-flow@alpha sparc run dev "$TASK" --verify
    npx claude-flow@alpha truth report
  env:
    VERIFICATION_MODE: strict
    TRUTH_THRESHOLD: 0.95
```

### PR Verification
```yaml
- name: Verify PR
  run: npx claude-flow@alpha verify --pr ${{ github.event.pull_request.number }}
```

## ⚡ Performance Tips with Verification

1. **Selective Verification** - Verify critical paths only
2. **Async Scoring** - Truth scores calculated in background
3. **Cache Results** - Reuse verification for unchanged code
4. **Batch Verification** - Verify multiple agents together

## 🚀 Migration Guide

### For Existing Projects
```bash
# 1. Install verification (non-breaking)
npx claude-flow@alpha init --add-verification

# 2. Start in passive mode
npx claude-flow verify --enable --mode passive

# 3. Monitor for 1 week
npx claude-flow truth report

# 4. Gradually increase enforcement
npx claude-flow verify --mode active  # After 1 week
npx claude-flow verify --mode strict  # After 2 weeks
```

## 📝 Configuration

### .claude/config/verification.json
```json
{
  "enabled": false,          // Start disabled
  "mode": "passive",         // passive|active|strict
  "truth_threshold": 0.80,   // Minimum acceptable score
  "rollback_enabled": false, // Auto-rollback on failure
  "weights": {
    "tests": 0.40,
    "lint": 0.20,
    "types": 0.20,
    "build": 0.20
  }
}
```

## 🎯 Benefits of Verification

1. **Trustworthy Output** - Know when AI claims are accurate
2. **Reduced Human Verification** - 75% less manual checking
3. **Automatic Rollback** - Never break working code
4. **Agent Improvement** - Agents learn from truth scores
5. **Audit Trail** - Complete verification history

## 🔍 Troubleshooting

### Low Truth Scores
```bash
# Check what's failing
npx claude-flow truth diagnose [agent-id]

# View detailed evidence
npx claude-flow truth evidence [task-id]

# Retrain agent
npx claude-flow agent retrain [agent-id] --focus verification
```

### Performance Impact
```bash
# Measure overhead
npx claude-flow benchmark --with-verification

# Optimize verification
npx claude-flow verify optimize

# Selective verification
npx claude-flow verify --only-critical
```

---

**Remember**: Verification is **opt-in** and **backward compatible**. Start passive, measure impact, then increase enforcement as confidence grows.

## Original Claude-Flow Features
[All existing Claude-Flow features continue to work as before...]