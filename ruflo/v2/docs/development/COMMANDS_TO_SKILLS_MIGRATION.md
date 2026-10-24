# Commands → Skills Migration Analysis

## Executive Summary
**Total Commands**: 150 files
**Recommended for Skills**: 35 files (23%)
**Keep as Commands**: 115 files (77%)

---

## ✅ RECOMMENDED: Convert to Skills

### 1. **Pair Programming Skill** (6 files → 1 skill)
**Rationale**: Complex multi-step workflow with modes, configuration, sessions
- `/pair/commands.md` (545 lines)
- `/pair/examples.md` (511 lines)
- `/pair/config.md` (509 lines)
- `/pair/session.md` (406 lines)
- `/pair/modes.md` (347 lines)
- `/pair/start.md` (208 lines)

**Total**: 2,526 lines of comprehensive workflow documentation
**Skill Name**: `pair-programming`

---

### 2. **GitHub Workflow Automation Skills** (12 files → 5 skills)

#### 2a. **GitHub Release Management Skill**
- `/github/release-swarm.md` (543 lines)
- `/github/release-manager.md` (337 lines)

**Skill Name**: `github-release-management`

#### 2b. **GitHub Multi-Repo Coordination Skill**
- `/github/multi-repo-swarm.md` (518 lines)
- `/github/sync-coordinator.md` (300 lines)
- `/github/repo-architect.md` (366 lines)

**Skill Name**: `github-multi-repo`

#### 2c. **GitHub Code Review Skill**
- `/github/code-review-swarm.md` (513 lines)
- `/github/swarm-pr.md` (284 lines)
- `/github/pr-manager.md` (169 lines)

**Skill Name**: `github-code-review`

#### 2d. **GitHub Issue & Project Management Skill**
- `/github/swarm-issue.md` (481 lines)
- `/github/project-board-sync.md` (470 lines)
- `/github/issue-tracker.md` (291 lines)

**Skill Name**: `github-project-management`

#### 2e. **GitHub Workflow Automation Skill**
- `/github/workflow-automation.md` (441 lines)
- `/github/github-modes.md` (146 lines)

**Skill Name**: `github-workflow-automation`

---

### 3. **Verification & Quality Skill** (3+ files → 1 skill)
- `/truth/start.md` (142 lines)
- `/verify/start.md`
- `/verify/check.md`

**Skill Name**: `verification-quality`

---

### 4. **SPARC Development Methodology Skill** (3+ files → 1 skill)
- `/sparc/sparc-modes.md` (174 lines)
- `/sparc/orchestrator.md` (131 lines)
- Additional SPARC files

**Skill Name**: `sparc-methodology`

---

### 5. **Flow Nexus Cloud Workflows Skills** (9 files → 3 skills)

#### 5a. **Flow Nexus Neural Network Training Skill**
- `/flow-nexus/neural-network.md` (133 lines)

**Skill Name**: `flow-nexus-neural`

#### 5b. **Flow Nexus Swarm Deployment Skill**
- `/flow-nexus/swarm.md`
- `/flow-nexus/workflow.md`

**Skill Name**: `flow-nexus-swarm`

#### 5c. **Flow Nexus Platform Management Skill**
- `/flow-nexus/user-tools.md` (151 lines)
- `/flow-nexus/sandbox.md`
- `/flow-nexus/app-store.md`
- `/flow-nexus/payments.md`
- `/flow-nexus/challenges.md`
- `/flow-nexus/login-registration.md`

**Skill Name**: `flow-nexus-platform`

---

### 6. **Advanced Swarm Orchestration Skill** (3 files → 1 skill)
- `/swarm/examples.md` (168 lines)
- `/swarm/research.md` (136 lines)
- `/swarm/testing.md` (131 lines)

**Skill Name**: `swarm-advanced`

---

### 7. **Bottleneck Analysis & Performance Skill** (3 files → 1 skill)
- `/analysis/bottleneck-detect.md` (162 lines)
- `/analysis/performance-bottlenecks.md`
- `/analysis/performance-report.md`

**Skill Name**: `performance-analysis`

---

### 8. **Stream Chain Workflow Skill** (2 files → 1 skill)
- `/stream-chain/pipeline.md`
- `/stream-chain/run.md`

**Skill Name**: `stream-chain`

---

### 9. **Hive Mind Advanced Workflows Skill** (11+ files → 1 skill)
- `/hive-mind/` comprehensive documentation
- Multiple coordination patterns

**Skill Name**: `hive-mind-advanced`

---

### 10. **Hooks & Automation Framework Skill** (5+ files → 1 skill)
- `/hooks/overview.md` (131 lines)
- Additional hook documentation

**Skill Name**: `hooks-automation`

---

## ❌ KEEP AS COMMANDS (Simple CLI operations)

### Analysis Commands (Keep)
- `token-usage.md` (26 lines) - Simple CLI query
- `token-efficiency.md` - Simple reporting

### Memory Commands (Keep)
- `memory-usage.md` - Simple memory operations
- `memory-search.md` - Quick searches
- `memory-persist.md` - Save/load operations
- `neural.md` - Neural status queries
- `usage.md` - Usage stats

### Monitoring Commands (Keep)
- Simple monitoring operations
- Status checks
- Metric queries

### Automation Commands (Keep)
- Simple automation triggers
- Basic workflow starts

### Swarm Commands (Keep as simple triggers)
- `swarm.md` (28 lines) - Simple CLI trigger
- `swarm-init.md` - Initialize swarm
- `swarm-status.md` - Check status
- `swarm-spawn.md` - Spawn agents
- `swarm-monitor.md` - Monitor swarm
- `swarm-background.md` - Background execution
- `development.md` - Dev mode
- `maintenance.md` - Maintenance mode
- `analysis.md` - Analysis mode
- `optimization.md` - Optimization mode

### Agents Commands (Keep)
- Simple agent spawning commands

### Training Commands (Keep)
- Simple training triggers

### Workflows Commands (Keep)
- Simple workflow triggers

### Coordination Commands (Keep)
- Simple coordination operations

---

## 📊 Summary Statistics

| Category | Files | Keep as Commands | Convert to Skills |
|----------|-------|------------------|-------------------|
| pair/ | 6 | 0 | 6 (→ 1 skill) |
| github/ | 12 | 0 | 12 (→ 5 skills) |
| flow-nexus/ | 9 | 0 | 9 (→ 3 skills) |
| sparc/ | 3+ | 0 | 3+ (→ 1 skill) |
| truth/ | 1 | 0 | 1 (→ 1 skill) |
| verify/ | 2 | 0 | 2 (→ 1 skill) |
| swarm/ | 16 | 13 | 3 (→ 1 skill) |
| analysis/ | 6 | 3 | 3 (→ 1 skill) |
| hooks/ | 5+ | 0 | 5+ (→ 1 skill) |
| hive-mind/ | 11+ | 0 | 11+ (→ 1 skill) |
| stream-chain/ | 2 | 0 | 2 (→ 1 skill) |
| **Simple Commands** | ~85 | ~85 | 0 |

**Total Skills to Create**: ~18-20 comprehensive skills
**Commands to Remove**: ~35 files (will be consolidated)
**Commands to Keep**: ~115 files

---

## 🎯 Implementation Priority

### Phase 1: High Impact (Immediate)
1. ✅ **skill-builder** (DONE)
2. **pair-programming** - Most comprehensive workflow (2,526 lines)
3. **verification-quality** - Critical for code quality
4. **github-code-review** - High usage workflow

### Phase 2: GitHub Integration
5. **github-release-management**
6. **github-multi-repo**
7. **github-project-management**
8. **github-workflow-automation**

### Phase 3: Advanced Features
9. **flow-nexus-neural**
10. **flow-nexus-swarm**
11. **flow-nexus-platform**
12. **sparc-methodology**

### Phase 4: Specialized Workflows
13. **swarm-advanced**
14. **performance-analysis**
15. **stream-chain**
16. **hive-mind-advanced**
17. **hooks-automation**

---

## 🔧 Migration Guidelines

### For each skill conversion:

1. **Create YAML frontmatter**:
```yaml
---
name: "Skill Name"
description: "Brief description of what this skill does and when Claude should use it. Maximum 1024 characters."
---
```

2. **Structure with progressive disclosure**:
```markdown
# Skill Name

## What This Skill Does
[Brief overview - always visible]

## Prerequisites
[Requirements - always visible]

## Quick Start
[Simple example - always visible]

---

## Complete Guide
[Detailed instructions - behind progressive disclosure fold]

### Step 1: Setup
...

### Step 2: Configuration
...

### Step 3: Execution
...

## Advanced Usage
...

## Troubleshooting
...

## Examples
...
```

3. **Remove from commands/**:
- Delete original .md files after migration
- Update any cross-references in other files
- Update README files in command directories

4. **Create skill directory structure**:
```
.claude/skills/
  ├── skill-builder/
  │   └── SKILL.md
  ├── pair-programming/
  │   └── SKILL.md
  ├── verification-quality/
  │   └── SKILL.md
  └── github-code-review/
      └── SKILL.md
```

---

## 🚫 Preventing Duplicates

### Current State
- **Commands**: 150 files in `.claude/commands/`
- **Skills**: 1 file in `.claude/skills/` (skill-builder)

### After Migration
- **Commands**: ~115 files (simple CLI operations)
- **Skills**: ~20 files (complex workflows)
- **Reduction**: ~35 command files removed (consolidated into skills)

### No Duplicates Because:
1. **Complex workflows** → **Skills** (with YAML frontmatter, progressive disclosure)
2. **Simple CLI triggers** → **Commands** (without YAML, concise reference)
3. **Clear separation of concerns**:
   - Commands: Execute operations (`npx claude-flow swarm "task"`)
   - Skills: Teach workflows (Claude learns patterns and best practices)
4. **Different discovery mechanisms**:
   - Commands: CLI help, documentation
   - Skills: Claude's autonomous discovery via YAML metadata

### Decision Criteria
| Aspect | Command | Skill |
|--------|---------|-------|
| Length | <100 lines | >200 lines |
| Complexity | Single operation | Multi-step workflow |
| Usage | CLI trigger | Learning resource |
| Structure | Simple markdown | YAML + progressive disclosure |
| Examples | 1-2 examples | 5-10+ examples |
| Config | Minimal | Extensive configuration |

---

## 📝 Next Steps

1. ✅ Review this analysis
2. Approve priority order
3. Begin Phase 1 skill creation:
   - [ ] Create `pair-programming` skill
   - [ ] Create `verification-quality` skill
   - [ ] Create `github-code-review` skill
4. Test each skill with Claude Code
5. Remove consolidated command files
6. Update documentation and references
7. Update `skills-copier.js` to handle new skills

---

## 💡 Benefits of Migration

1. **Better Organization**: Complex workflows in one place
2. **Improved Discovery**: Claude can find and use skills autonomously
3. **Reduced Duplication**: Consolidate related commands
4. **Enhanced Learning**: Progressive disclosure teaches best practices
5. **Cleaner Commands**: Keep only simple CLI triggers
6. **Better Maintenance**: Easier to update comprehensive workflows

---

## ⚠️ Important Notes

- **DO NOT** convert simple CLI commands to skills
- **DO NOT** duplicate content between commands and skills
- **DO** ensure skills have complete, standalone workflows
- **DO** keep commands as lightweight CLI triggers
- **DO** test each skill in Claude Code before removing commands
