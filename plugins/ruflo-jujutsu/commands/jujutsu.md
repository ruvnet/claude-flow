---
name: jujutsu
description: Git diff analysis with risk scoring and change classification
---

Analyze current git changes:

1. Pick the ref to compare against (default `HEAD`; for a branch use `main..feature`, for the last commit `HEAD~1`). The tools run git themselves and take a `ref`, not diff text
2. Call `mcp__plugin_ruflo-core_ruflo__analyze_diff` with `{ ref, includeFileRisks: true }` for comprehensive analysis
3. Call `mcp__plugin_ruflo-core_ruflo__analyze_diff-risk` with `{ ref }` for risk score
4. Call `mcp__plugin_ruflo-core_ruflo__analyze_diff-classify` with `{ ref }` for change type classification
5. Call `mcp__plugin_ruflo-core_ruflo__analyze_diff-reviewers` with `{ ref, limit }` for suggested reviewer roles; check CODEOWNERS separately for actual owners
6. Present: risk level, change type, affected files, and suggested reviewer roles
