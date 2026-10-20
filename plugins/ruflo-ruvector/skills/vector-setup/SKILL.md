---
name: vector-setup
description: First-run setup for ruvector@0.3.3 — installs ONNX/Brain/SONA add-ons, registers the MCP server, and verifies the install via `doctor`
argument-hint: "[--full]"
allowed-tools: Bash Read
---

# Vector Setup

Bootstraps `ruvector@0.3.3` and its optional add-ons so every `/vector` subcommand actually works on first run.

## Why this exists

Out of the box, several `/vector` subcommands fail with a confusing dep error:

| Error | Missing package |
|-------|-----------------|
| `ONNX WASM files not bundled. The onnx/ directory is missing.` | none — upgrade to ruvector 0.3.3, which bundles it (0.2.x lacks it) |
| `Brain commands require @ruvector/pi-brain` | `@ruvector/pi-brain` |
| `SONA not available. Native error: Cannot find module '/.../@ruvector/sona/index.js'` | `@ruvector/ruvllm` (JS fallback) |
| `LLM commands require @ruvector/ruvllm` | `@ruvector/ruvllm` |

This skill installs them in one pass.

## Steps

1. **Pin ruvector**:
   ```bash
   npm install ruvector@0.3.3
   ```
2. **Install the add-ons** (idempotent — only what's missing):
   ```bash
   npm install @ruvector/pi-brain \
               @ruvector/ruvllm
   ```
   For a leaner install, pass `--full` to also pull `@ruvector/graph-node` and `@ruvector/router`:
   ```bash
   npm install @ruvector/pi-brain \
               @ruvector/ruvllm \
               @ruvector/graph-node \
               @ruvector/router
   ```
3. **Verify the binary**:
   ```bash
   npx -y ruvector@0.3.3 doctor
   npx -y ruvector@0.3.3 info
   ```
4. **Register the MCP server**:
   ```bash
   claude mcp add ruvector -- npx -y ruvector@0.3.3 mcp start
   claude mcp list | grep ruvector
   ```
5. **Sanity check** the most common subcommands:
   ```bash
   npx -y ruvector@0.3.3 hooks route "test"
   npx -y ruvector@0.3.3 attention list
   npx -y ruvector@0.3.3 rvf examples
   ```
6. **(Optional) Generate a pi identity** for brain + edge:
   ```bash
   npx -y ruvector@0.3.3 identity generate
   npx -y ruvector@0.3.3 identity show
   ```

## Smoke test

For a deterministic verification of the install, run the plugin's bundled smoke script:
```bash
bash plugins/ruflo-ruvector/scripts/smoke.sh
```

It checks: version pin, top-level subcommand visibility, `hooks ast-analyze`, `hooks route`, `attention list`, `rvf examples`, and `info`. Exits non-zero if any drift from the contracted surface is detected.

## What this does not install

- Native Rust toolchain (optional; only needed for source builds)
- Platform-specific native bindings (auto-detected by `@ruvector/core`)
- `@ruvector/sona` native binding (the JS fallback via `@ruvector/ruvllm` is sufficient on macOS arm64; Linux x64 has its own native binding)

If `doctor` still reports a problem after this skill runs, paste its output verbatim and ask.
