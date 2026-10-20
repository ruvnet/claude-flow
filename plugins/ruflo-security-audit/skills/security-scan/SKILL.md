---
name: security-scan
description: Run full security scans on the codebase using Ruflo security tools. Use when reviewing PRs for security regressions, auditing auth/input-handling code, before production deploys, or when the user asks for a security check at quick/standard/deep depth.
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__hooks_post-task Read Grep
argument-hint: "[depth: quick|standard|deep]"
---
Run a security scan at the specified depth.

Via CLI:
```bash
npx @claude-flow/cli@latest security scan --depth DEPTH --output json
npx @claude-flow/cli@latest security cve --list
npx @claude-flow/cli@latest security threats --model stride --export md
```

What the scan really does (`v3/@claude-flow/cli/src/commands/security.ts`): phase 1 runs `npm audit` for dependencies, phase 2 greps for hard-coded secrets, phase 3 greps source for risky code patterns. `--type deps|code|all` picks phases; `--depth` only sets how many directory levels phases 2 and 3 descend:

| Depth | Dependencies | Secrets (levels) | Code patterns (levels) |
|-------|--------------|------------------|------------------------|
| quick | yes | 3 | skipped |
| standard | yes | 5 | 5 |
| deep | yes | 10 | 10 |

It is a pattern scanner, not a taint or auth-flow analyser, and `security threats` is a separate STRIDE/DREAD/PASTA template, not a scan of your code. Treat every finding as a lead, not a verdict: open the file at the reported line before reporting it, and drop matches in comments, error strings, generated bundles (`coverage/`, `playwright-report/`) and test fixtures. Say which of the phases above you ran and which you did not.

Store findings via MCP: `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "scan-findings", value: "SUMMARY", namespace: "security-findings" })`

Train patterns: `mcp__plugin_ruflo-core_ruflo__hooks_post-task({ taskId: "security-scan", success: true, storeResults: true })`
