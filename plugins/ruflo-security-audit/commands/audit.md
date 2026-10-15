---
name: audit
description: Run a security audit on the project
---
$ARGUMENTS
Run a Ruflo security audit. Accepts optional flags:

Usage: /audit [--depth quick|standard|deep] [--target <dir>] [--fix]

Defaults to `--depth standard` on the current project root. Parse the depth from $ARGUMENTS and accept only `quick`, `standard` or `deep`; accept `--target` only as a path that resolves inside the project. Never paste other argument text into the shell command.

Steps:
1. `npx @claude-flow/cli@latest security scan --depth DEPTH --target TARGET --output json`
2. `npx @claude-flow/cli@latest security cve --list`
3. `npx @claude-flow/cli@latest security threats --model stride --export md`

`--fix` is never run silently: only when the user passed it, after showing what would change; it edits files, so require a clean git tree first.

Store findings in memory for pattern training:
`npx @claude-flow/cli@latest memory store --namespace security-findings --key "audit-YYYY-MM-DD" --value "FINDINGS_SUMMARY"`
