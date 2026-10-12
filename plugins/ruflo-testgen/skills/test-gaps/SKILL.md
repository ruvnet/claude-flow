---
name: test-gaps
description: Detect missing test coverage and generate test suggestions. Use when the user asks about coverage gaps, untested code, or what tests to write next; also after adding a feature to find what still needs tests.
argument-hint: "[--path PATH] [--threshold N]"
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch Read Grep
---
Find test coverage gaps via CLI:
```bash
npx @claude-flow/cli@latest hooks coverage-gaps --format table --threshold 80   # add --critical-only for the worst gaps (there is no --limit)
npx @claude-flow/cli@latest hooks coverage-route --task 'add auth tests'
npx @claude-flow/cli@latest hooks coverage-suggest --path src/
```

Or dispatch the testgaps worker via MCP:
`mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch({ trigger: "testgaps" })`

For continuous detection, use `/loop` with the `loop-worker` skill targeting the `testgaps` worker.
