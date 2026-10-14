---
name: diff-analyze
description: Analyze git diffs for risk scoring, reviewer recommendations, and change classification. Use when preparing a PR, reviewing a large or cross-module change, or before merging to assess risk and pick reviewers.
argument-hint: "[--branch BRANCH] [--pr PR#]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__analyze_diff mcp__plugin_ruflo-core_ruflo__analyze_diff-risk mcp__plugin_ruflo-core_ruflo__analyze_diff-classify mcp__plugin_ruflo-core_ruflo__analyze_diff-reviewers mcp__plugin_ruflo-core_ruflo__analyze_diff-stats mcp__plugin_ruflo-core_ruflo__analyze_file-risk Bash
---

# Diff Analysis

Analyze git diffs for risk, complexity, and reviewer assignment.

## When to use

Before submitting a PR or after making significant changes, analyze the diff to understand risk level, get reviewer recommendations, and classify the type of change.

## Steps

0. **Pick the ref** — `HEAD` for uncommitted work, `main..BRANCH` for a branch (`--branch`), or the PR's base..head range (`--pr`, resolve it with `gh pr view N --json baseRefName,headRefName`). The analyze_* tools take a `ref` and run git themselves; they do not accept diff text.
1. **Analyze diff** — call `mcp__plugin_ruflo-core_ruflo__analyze_diff` with `{ ref, includeFileRisks: true }` for a comprehensive analysis
2. **Risk score** — call `mcp__plugin_ruflo-core_ruflo__analyze_diff-risk` with `{ ref }` for a quantified risk assessment
3. **Classify changes** — call `mcp__plugin_ruflo-core_ruflo__analyze_diff-classify` with `{ ref }` to categorize (feature, bugfix, refactor, etc.)
4. **Get reviewer roles** — call `mcp__plugin_ruflo-core_ruflo__analyze_diff-reviewers` with `{ ref, limit }` for roles inferred from paths and risk; check CODEOWNERS separately when assigning people
5. **Diff stats** — call `mcp__plugin_ruflo-core_ruflo__analyze_diff-stats` with `{ ref }` for line counts, file counts, complexity metrics
6. **File-level risk** — call `mcp__plugin_ruflo-core_ruflo__analyze_file-risk` with `{ path }` (required) for each file the earlier steps flagged

## Risk factors

- Files with high churn history
- Security-sensitive paths (auth, crypto, permissions)
- Large diffs (>500 lines)
- Cross-module changes
- Database migration files
