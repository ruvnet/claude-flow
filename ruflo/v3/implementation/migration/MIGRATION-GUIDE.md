# Claude-Flow v2 to v3 Migration Guide

## Overview

This guide walks you through migrating from Claude-Flow v2.x to v3.0. The migration is designed to be **zero-breaking-changes** - all v2 code continues to work while you gradually adopt v3 features.

## Prerequisites

- Node.js >= 18.0.0
- Claude-Flow v2.7.x installed
- Git for version control

## Quick Migration (5 minutes)

### Step 1: Update Dependencies

```bash
# Update to v3
npm install claude-flow@3.0.0

# Install new optional dependencies
npm install sql.js  # Windows support
```

### Step 2: Run Auto-Migration

```bash
npx claude-flow migrate --to v3
```

This command:
- Backs up your current config to `.claude/config.json.v2.backup`
- Migrates settings to v3 format
- Consolidates duplicate settings files
- Archives old checkpoints

### Step 3: Verify

```bash
# Run compatibility tests
npm run test:compatibility

# Check migration status
npx claude-flow status --check-migration
```

## Manual Migration Steps

If you prefer manual control or auto-migration fails:

### 1. Configuration Migration

#### Before (v2)
```
.claude/
├── settings.json
├── settings-enhanced.json
├── settings-complete.json
├── settings-github-npx.json
└── ... (9 files total)
```

#### After (v3)
```
.claude/
├── config.json              # Master config
├── settings.prod.json       # Production
├── settings.dev.json        # Development
└── settings.github.json     # GitHub automation
```

#### Migration Steps

1. **Create unified config.json**:
```json
{
  "version": "3.0.0",
  "agenticFlow": {
    "enabled": true,
    "attention": "flash",
    "sona": "balanced",
    "learning": true
  },
  "extends": "./settings.prod.json"
}
```

2. **Merge settings files**:
```bash
# settings.prod.json = settings-enhanced.json content
cp .claude/settings-enhanced.json .claude/settings.prod.json

# Update version in settings.prod.json
```

3. **Remove deprecated files**:
```bash
rm .claude/settings-complete.json
rm .claude/settings-checkpoint-*.json
rm .claude/settings.reasoningbank-*.json
rm .claude/settings-npx-hooks.json
```

### 2. Hooks Migration

#### Before (v2)
Hooks scattered in multiple files:
- `.claude/settings-enhanced.json`
- `.claude/settings-complete.json`
- `.claude-plugin/hooks/hooks.json`

#### After (v3)
Single source in `config.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "commands": ["npx claude-flow hooks pre-tool --tool=$TOOL_NAME"]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "commands": ["npx claude-flow hooks post-tool --tool=$TOOL_NAME"]
      }
    ]
  }
}
```

### 3. Agent Directory Migration

#### Before (v2)
```
.claude/agents/
├── consensus/
├── core/
├── devops/
├── flow-nexus/
├── github/
├── hive-mind/
├── orchestration/
├── performance/
├── planning/
├── sparc/
├── specialized/
├── swarm/
├── templates/
├── testing/
└── ... (22 directories)
```

#### After (v3)
```
.claude/agents/
├── core/           # Essential: coder, tester, reviewer, researcher, planner
├── orchestration/  # All coordinators consolidated
├── platform/       # github, flow-nexus, devops
├── specialized/    # Domain experts
├── methodology/    # sparc, tdd
├── consensus/      # Distributed consensus
└── testing/        # Quality & validation
```

### 4. Code Updates

#### Agent Creation (Optional Enhancement)

```typescript
// v2 code (still works!)
const coordinator = new SwarmCoordinator();
const agentId = await coordinator.spawnAgent({ type: 'coder' });

// v3 enhanced (opt-in)
import { AgenticFlowAdapter } from 'claude-flow/v3';
const adapter = new AgenticFlowAdapter({ sona: 'research' });
const agentId = await adapter.createAgent('coder', {
  learning: true,       // +55% quality
  reflexion: true       // Self-improvement
});
```

#### Memory Operations (Optional Enhancement)

```typescript
// v2 code (still works!)
const memory = new MemoryManager();
const results = await memory.search('query');

// v3 enhanced (opt-in)
import { HybridMemorySystem } from 'claude-flow/v3';
const memory = new HybridMemorySystem();
const results = await memory.search('query', {
  semantic: true,       // AgentDB vector search
  k: 5                  // 150x faster with HNSW
});
```

## Windows Users: sql.js Setup

### Automatic (Recommended)

```bash
npm install sql.js
```

Claude-Flow v3 automatically detects Windows and uses sql.js.

### Manual Configuration

```json
// .claude/config.json
{
  "database": {
    "provider": "sql.js"  // Force sql.js even on Linux/macOS
  }
}
```

### Feature Availability

| Feature | better-sqlite3 | sql.js |
|---------|---------------|--------|
| Core operations | ✅ | ✅ |
| Memory storage | ✅ | ✅ |
| Swarm coordination | ✅ | ✅ |
| ReasoningBank | ✅ | ❌ |
| Vector search | ✅ | ❌ |

## Checkpoint Cleanup

v2 accumulated 3,720+ checkpoint files. v3 auto-archives old ones.

### Manual Cleanup

```bash
# Archive checkpoints older than 7 days
cd .claude/checkpoints
mkdir -p archive
find . -maxdepth 1 -name "*.json" -mtime +7 -exec mv {} archive/ \;
tar -czf archive.tar.gz archive/
rm -rf archive/
```

### Automatic (v3)

```json
// .claude/config.json
{
  "checkpoints": {
    "maxActive": 20,
    "archiveAfterDays": 7,
    "compressArchive": true
  }
}
```

## Enabling v3 Features

### SONA Learning Profiles

```json
// .claude/config.json
{
  "agenticFlow": {
    "sona": "research"  // Options: real-time, balanced, research, edge, batch
  }
}
```

| Profile | Quality | Speed | Use Case |
|---------|---------|-------|----------|
| real-time | Baseline | <0.5ms | Live apps |
| balanced | +25% | 18ms | Default |
| research | +55% | 18ms | Max accuracy |
| edge | Balanced | Minimal | <5MB footprint |
| batch | +25% | 15-50ms | Processing |

### Flash Attention

```json
// .claude/config.json
{
  "agenticFlow": {
    "attention": "flash"  // 2.49x-7.47x speedup
  }
}
```

### GNN-Enhanced Search

```typescript
import { AgenticFlowAdapter } from 'claude-flow/v3';

const adapter = new AgenticFlowAdapter({ enableGNN: true });
const results = await adapter.searchPatterns(query, {
  k: 5,
  graphContext: knowledgeBase  // +12.4% accuracy
});
```

## Rollback

If you need to rollback to v2:

```bash
# Restore v2 config
cp .claude/config.json.v2.backup .claude/config.json

# Downgrade package
npm install claude-flow@2.7.47

# Restore v2 settings (if needed)
git checkout HEAD~1 -- .claude/settings-*.json
```

## Troubleshooting

### "Module not found: agentic-flow"

```bash
npm install agentic-flow@2.0.1-alpha.0
```

### "sql.js WASM loading failed"

```bash
# Ensure WASM file is accessible
npm rebuild sql.js
```

### "v2 API deprecated warning"

These are informational only. Your code still works. To silence:

```json
// .claude/config.json
{
  "deprecationWarnings": false
}
```

### "Migration failed: hooks conflict"

Manual resolution needed:
1. Open `.claude/config.json.v2.backup`
2. Copy hook definitions
3. Paste into `.claude/config.json` under `hooks` key

## Support

- Documentation: https://github.com/ruvnet/claude-flow/docs/v3
- Issues: https://github.com/ruvnet/claude-flow/issues
- Discussions: https://github.com/ruvnet/claude-flow/discussions

---

*Migration Guide Version: 1.0.0*
