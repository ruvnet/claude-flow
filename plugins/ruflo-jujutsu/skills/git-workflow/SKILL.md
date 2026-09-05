---
name: git-workflow
description: Advanced git workflows with branch management, conflict resolution, and PR lifecycle
argument-hint: "<branch|pr|merge|rebase> [options]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__analyze_diff mcp__plugin_ruflo-core_ruflo__analyze_diff-risk mcp__plugin_ruflo-core_ruflo__analyze_diff-stats mcp__plugin_ruflo-core_ruflo__github_pr_manage mcp__plugin_ruflo-core_ruflo__github_repo_analyze mcp__plugin_ruflo-core_ruflo__github_metrics Bash
---

# Git Workflow

Advanced git workflow automation for branch management and PR lifecycle.

## When to use

When managing complex git operations — multi-branch workflows, release branching, conflict resolution, or PR coordination.

## Steps

1. **Analyze repo** — call `mcp__plugin_ruflo-core_ruflo__github_repo_analyze` for repository health metrics
2. **Check diff risk** — call `mcp__plugin_ruflo-core_ruflo__analyze_diff-risk` before merging
3. **Manage PRs** — call `mcp__plugin_ruflo-core_ruflo__github_pr_manage` for PR lifecycle operations
4. **View metrics** — call `mcp__plugin_ruflo-core_ruflo__github_metrics` for merge frequency, review times, etc.

## Common workflows

### Feature branch
```bash
git checkout -b feat/my-feature
# ... make changes ...
# analyze diff before PR
# create PR with risk assessment
```

### Release branch
```bash
git checkout -b release/v1.2.0
# cherry-pick fixes
# analyze all diffs for risk
# merge when risk score is acceptable
```

## CLI alternative

```bash
npx @claude-flow/cli@latest hooks pre-task --description "git workflow"
```
