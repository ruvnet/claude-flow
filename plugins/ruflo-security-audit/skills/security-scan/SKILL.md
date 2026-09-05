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

| Depth | Checks |
|-------|--------|
| quick | Dependencies, known CVEs |
| standard | + Input validation, path traversal, secrets |
| deep | + Threat modeling, injection vectors, auth flows |

Store findings via MCP: `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "scan-findings", value: "SUMMARY", namespace: "security-findings" })`

Train patterns: `mcp__plugin_ruflo-core_ruflo__hooks_post-task({ taskId: "security-scan", success: true, storeResults: true })`
