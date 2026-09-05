# Copilot SDK x RuFlo Integration — Research & Design

> Branch: research/copilot-sdk-ruflo-integration
> Date: 2026-06-03
> Status: Research (Proposed)
> Mirrors: @claude-flow/codex (v3.0.0-alpha.9) modular pattern

---

## 1. Executive Summary

- **The GitHub Copilot SDK** (`@github/copilot-sdk`, GA 2026-06-02) is a multi-language client library that exposes the same agentic runtime powering the GitHub Copilot app — planning, tool invocation, streaming, multi-turn sessions, MCP server registration, and custom tool calling — directly to any application or CLI without requiring a separate orchestration layer. [1][2]
- **Why it matters for RuFlo:** Copilot SDK gives RuFlo a third programming-agent platform alongside Claude (`claude -p`) and OpenAI Codex (`codex exec`). GPT-5.3-Codex is the current LTS base model for Copilot Business/Enterprise; GPT-5.5 is the frontier model. Adding a `copilot:` worker prefix to the existing `DualModeOrchestrator` creates tri-mode collaboration with no breaking changes. [3][4]
- **The new package** `@claude-flow/copilot` will mirror `@claude-flow/codex` exactly: same exports shape, same `/loop` runner, same `initializer` pattern, same generators/validators/migrations. Net-new subfolders are `client/` (wraps `@github/copilot-sdk`) and `mcp/` (bidirectional MCP bridge). [5]
- **Model story:** GPT-5.3-Codex (1x multiplier, LTS through 2027-02-04) is the recommended Tier 3 coding model. GPT-5.4 mini (0.33x) is the Tier 2 fast model. GPT-5.5 (7.5x) is available for Tier 3 reasoning on Pro+/Business/Enterprise. [3][4][6]
- **Governance story:** Every Copilot call is wrapped by `@claude-flow/guidance` compile/enforce/prove/evolve, and all three hook entry points (`pre-task` → `route` → Copilot → `post-task`) fire so that cost tracking and neural learning work identically to the Claude and Codex adapters. [7][8]

---

## 2. Source Inventory

| # | URL / Document | Date Fetched | Grade | Notes |
|---|----------------|--------------|-------|-------|
| [1] | https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started | 2026-06-03 | A | Primary SDK tutorial; session API shape, transport, MCP config confirmed |
| [2] | https://github.blog/changelog/2026-06-02-copilot-sdk-is-now-generally-available/ | 2026-06-03 | A | GA announcement; auth methods, BYOK, MIT license confirmed |
| [3] | https://github.blog/changelog/2026-05-17-gpt-5-3-codex-is-now-the-base-model-for-copilot-business-and-enterprise/ | 2026-06-03 | A | GPT-5.3-Codex model ID, LTS status, 1x multiplier confirmed |
| [4] | https://github.blog/changelog/2026-04-24-gpt-5-5-is-generally-available-for-github-copilot/ | 2026-06-03 | A | GPT-5.5, 7.5x multiplier, supported plans confirmed |
| [5] | /Users/cohen/Projects/ruflo/v3/@claude-flow/codex/ | 2026-06-03 | A | Direct local read; all source files read, patterns confirmed |
| [6] | https://docs.github.com/en/copilot/reference/ai-models/supported-models | 2026-06-03 | A | Full model catalog; GA vs preview, agent/ask/edit mode support |
| [7] | /Users/cohen/Projects/ruflo/v3/@claude-flow/guidance/src/index.ts | 2026-06-03 | A | Direct local read; GuidanceControlPlane API confirmed |
| [8] | /Users/cohen/Projects/ruflo/CLAUDE.md | 2026-06-03 | A | Governance hooks, routing rules, dual-mode orchestrator docs |
| [9] | https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/mcp | 2026-06-03 | A | MCP config shape, stdio/HTTP transport, client-side arch confirmed |
| [10] | https://github.com/github/copilot-sdk | 2026-06-03 | A | GitHub repo; MIT license, 6-language support, auth env vars |
| [11] | https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing | 2026-06-03 | B | Pricing table; multipliers partially confirmed from changelogs |
| [12] | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models | 2026-06-03 | A | BYOK env vars, supported providers, tool-call + streaming requirement |
| [13] | https://www.npmjs.com/package/@github/copilot-sdk | 2026-06-03 | C | npm 403 — version confirmed via search as 1.0.0-beta.12, not from registry directly |
| [14] | https://github.blog/changelog/2026-05-20-updates-to-available-models-in-copilot-on-web/ | 2026-06-03 | B | Web model removals; GPT-5.2-Codex, GPT-5.4 nano removed from web |
| [15] | https://docs.github.com/en/copilot/reference/ai-models/model-comparison | 2026-06-03 | B | Model comparison table accessed; SDK model ID strings not exposed in page |

**Contradictions noted:**
- The npm search result listed version `1.0.0-beta.12` for `@github/copilot-sdk`, which calls itself a beta despite the GA announcement. The GA announcement does not specify the npm version. Possible explanation: npm package remains in semver pre-release during a rolling GA. **Resolution: treat npm package name as confirmed (`@github/copilot-sdk`), treat version as [unverified-exact] until registry is accessible.** [2][13]
- Model catalog page lists `GPT-5.4 nano` as "GA" but the web-models changelog removed it from web surfaces. **Resolution: GPT-5.4 nano remains GA in the SDK but is not surfaced on github.com chat UI.** [6][14]

---

## 3. The Copilot SDK — Technical Profile

### 3.1 Architecture

The SDK follows a **client-session model** operating via JSON-RPC between the SDK client library and a Copilot CLI server process: [1][10]

```
Your App (SDK client)
  │  JSON-RPC over stdio
  ▼
Copilot CLI server (auto-spawned or external)
  │  HTTPS
  ▼
GitHub Copilot backend (model routing, tool execution, AI credits)
```

**Alternative (external server mode):** run `copilot --headless --port 4321` independently, then connect via `new CopilotClient({ uri: "localhost:4321" })`. This is the preferred mode for RuFlo because:
- One CLI process can be shared across multiple SDK sessions.
- The CLI can be debugged independently.
- Non-loopback binding is possible (requires `--host 0.0.0.0` and network security controls).

**Auth flow:** The Copilot CLI handles authentication transparently using the first available credential source, in this priority order: [2][10][12]
1. `COPILOT_GITHUB_TOKEN` environment variable
2. `GH_TOKEN` / `GITHUB_TOKEN` environment variables
3. GitHub CLI stored OAuth token (from `gh auth login`)
4. GitHub Apps token

**Session permission model:** Sessions expose an `onPermissionRequest` handler. In production, provide a custom handler that evaluates and approves/denies AI model access requests. During development, use `PermissionHandler.approve_all`.

**BYOK:** The SDK supports Bring Your Own Key via environment variables (`COPILOT_PROVIDER_BASE_URL`, `COPILOT_MODEL`, `COPILOT_PROVIDER_API_KEY`, `COPILOT_PROVIDER_TYPE`), enabling Azure OpenAI, Anthropic, Ollama, or any OpenAI-compatible endpoint as the model backend. BYOK models must support tool calling and streaming with at least 128k context. [12]

### 3.2 Package Identity

| Attribute | Value | Source |
|-----------|-------|--------|
| npm package | `@github/copilot-sdk` | [1][2] |
| npm version | `1.0.0-beta.12` (latest as of 2026-06-02) | [13] — [unverified-exact, registry blocked] |
| License | MIT | [10] |
| Runtime requirement | Node.js 20+ | [1] |
| Copilot CLI bundled | Yes (auto-bundled for Node.js, Python, .NET) | [10] |
| Peer dependencies | Optional: `@opentelemetry/api` for tracing | [1] |
| Install | `npm install @github/copilot-sdk tsx` | [1] |
| Install footprint | [unverified — registry blocked] | [13] |

Additional language packages (not needed for RuFlo's Node.js surface): `github-copilot-sdk` (Python), `github.com/github/copilot-sdk/go`, `GitHub.Copilot.SDK` (.NET), `github-copilot-sdk` (Rust), `com.github:copilot-sdk-java` (Maven).

### 3.3 Capability Surface

| Capability | SDK Support | Notes |
|------------|-------------|-------|
| Chat completions | Yes | `session.sendAndWait({ prompt })` |
| Streaming | Yes | `streaming: true` + `assistant.message_delta` events |
| Multi-turn sessions | Yes | Session persists context across calls |
| Tool / function calling | Yes | `defineTool()` with JSON Schema params |
| MCP server connection | Yes | `mcpServers` in session config |
| MCP server hosting | Indirect | SDK connects TO MCP servers; RuFlo hosts its own MCP server separately |
| Custom system prompt | Yes | Full replace or granular section modification (identity, tone, guidelines) |
| File context | Yes | Repository-backed sessions via cloud agent mode |
| OpenTelemetry tracing | Yes | Optional; W3C trace context propagation |
| Agent mode | Yes | Multi-step autonomous execution |
| Ask mode | Yes | Single-turn Q&A |
| Edit mode | Yes | File edit suggestions |

### 3.4 MCP Feature Detail

From the `/features/mcp` documentation [9]:

**Architecture (CRITICAL for design):** MCP servers run **client-side** — they are separate processes spawned by the SDK, communicating via stdin/stdout for local servers or via HTTP for remote servers. The Copilot backend (github.com) does NOT host or execute MCP servers. This means RuFlo's MCP server (`npx ruflo mcp start`) runs on the user's machine and the SDK wires it in.

**Tool registration shape:**
```typescript
// In session config:
mcpServers: {
  ruflo: {
    type: "local",           // or "remote"
    command: "npx",
    args: ["-y", "ruflo@latest", "mcp", "start"],
    tools: ["*"],            // or ["memory_store", "memory_search", ...]
    // env?: Record<string, string>
    // cwd?: string
    // timeout?: number (ms)
  }
}
```

For remote HTTP servers:
```typescript
mcpServers: {
  "ruflo-remote": {
    type: "remote",
    url: "https://your-ruflo-mcp.example.com/mcp",
    headers: { Authorization: "Bearer ${RUFLO_MCP_TOKEN}" },
    tools: ["memory_search", "swarm_init"],
  }
}
```

**Tools field semantics:**
- `["*"]` — all tools from the MCP server are available
- `["tool-name1", "tool-name2"]` — explicit whitelist
- `[]` — all tools disabled

**MCP spec revision:** The GitHub documentation does not cite a specific MCP spec revision number. It references modelcontextprotocol.io generally. **[unverified — cannot confirm spec version without a versioned citation.]** The transport (stdio + HTTP) matches MCP 2024-11-05 and later drafts.

**Streaming tool calls:** Not mentioned in the MCP documentation. **[unverified — treat as unsupported until confirmed.]**

### 3.5 Limits, Quotas, Pricing Implications

| Item | Status | Source |
|------|--------|--------|
| GPT-5.3-Codex multiplier | 1x premium AI credits | [3] |
| GPT-5.4 mini multiplier | 0.33x | [6] via Claude Haiku 4.5 comparable pricing |
| GPT-5.5 multiplier | 7.5x (promotional) | [4] |
| Claude Haiku 4.5 multiplier | 0.33x | [6][11] |
| Rate limit headers | [unverified — not documented in SDK or CLI docs] | — |
| Per-seat vs per-request | Both: per-seat subscription + AI credits for premium models | [11] |
| Free tier | Copilot Free includes base model access (GPT-5.3-Codex base) | [2] |
| BYOK pricing | $0 AI credits (user's own API key billed by provider) | [12] |

Usage headers (for cost tracking integration) are **not documented** in the SDK. This is an open question for the `@claude-flow/copilot` implementation.

### 3.6 Constraints Relevant to Embedding in a 3rd-Party CLI

| Constraint | Finding | Source |
|------------|---------|--------|
| License | MIT — permissive, no redistribution restriction | [10] |
| Terms of Service | Standard GitHub ToS applies; no explicit prohibition on 3rd-party CLI embedding found | [2] |
| Attribution | None specified | [2][10] |
| Telemetry | Optional OpenTelemetry only; no mandatory telemetry found | [1] |
| Token exposure | SDK auth uses env vars / stored OAuth; tokens never echoed by the SDK itself | [10] |
| Admin policy | Business/Enterprise admins can restrict which models users can select | [4] |
| Non-GA models | Preview models (e.g., Raptor mini, Gemini 3 Flash) require Business/Enterprise admin approval | [6] |

**No explicit ToS prohibition on embedding in a 3rd-party CLI was found.** The GA announcement explicitly lists "an internal code analysis tool, a custom release-notes generator, or an agent embedded in a support workflow" as intended use cases. [2]

---

## 4. Latest Copilot-Supported GPT Models (as of 2026-06-03)

The table below covers OpenAI GPT-family models only, as the user specifically asked for "the most recent GPT models." The full catalog includes Anthropic Claude and Google Gemini models (see Section 3.5 for pricing). Models marked "Closing down 2026-06-01" are being retired.

| Model ID (display name) | SDK model string [unverified-exact] | Provider | Status | Agent | Ask | Edit | CLI | Context Window | Tool Use | Streaming | Multiplier | RuFlo Tier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GPT-4.1 | `gpt-4.1` | OpenAI | Retiring 2026-06-01 | Y | Y | Y | N | [unverified] | Y | Y | 0x (deprecated) | — |
| GPT-5 mini | `gpt-5-mini` [unverified] | OpenAI | GA | Y | Y | Y | Y | [unverified] | Y | Y | [unverified] | Tier 2 |
| GPT-5.2 | `gpt-5.2` [unverified] | OpenAI | Retiring 2026-06-01 | Y | Y | Y | N | [unverified] | Y | Y | — | — |
| GPT-5.2-Codex | `gpt-5.2-codex` [unverified] | OpenAI | Retiring 2026-06-01 | Y | Y | Y | N | [unverified] | Y | Y | — | — |
| **GPT-5.3-Codex** | `gpt-5.3-codex` | OpenAI | **GA / LTS** (until 2027-02-04) | Y | Y | Y | Y | [unverified, 1M+ per catalog] | Y | Y | **1x** | **Tier 3 (default coder)** |
| GPT-5.4 | `gpt-5.4` [unverified] | OpenAI | GA | Y | Y | Y | Y | [unverified] | Y | Y | [unverified] | Tier 3 |
| GPT-5.4 mini | `gpt-5.4-mini` [unverified] | OpenAI | GA | Y | Y | Y | Y | [unverified] | Y | Y | **0.33x** | **Tier 2 (fast)** |
| GPT-5.4 nano | `gpt-5.4-nano` [unverified] | OpenAI | GA (not on web UI) | N | N | N | N | [unverified] | N/A | N/A | [unverified] | Not recommended |
| **GPT-5.5** | `gpt-5.5` [unverified] | OpenAI | **GA** | Y | Y | Y | Y | [unverified] | Y | Y | **7.5x** (promo) | **Tier 3 (reasoning/frontier)** |

**Notes:**
- SDK model ID strings: the string `gpt-5.3-codex` is confirmed callable via `copilot --model gpt-5.3-codex` in the CLI [3]; the pattern suggests `gpt-5.4-mini`, `gpt-5.5` etc. follow the same lowercased hyphen convention. All except `gpt-5.3-codex` are marked `[unverified-exact]` — confirm via `client.listModels()` at runtime.
- GPT-5.3-Codex is the **default base model** for all Copilot Business and Enterprise since 2026-05-17, replacing GPT-4.1. It is the first Copilot LTS model, guaranteed available until 2027-02-04. [3]
- GPT-5.5 is the frontier model (April 2026 GA), optimized for "complex, multi-step agentic coding tasks." It requires explicit admin enablement for Business/Enterprise. [4]
- GPT-5.4 nano has no agent/ask/edit mode support in the catalog; it is excluded from the Copilot Chat UI on web as of May 2026. [6][14]
- The SDK documentation confirms models available via Copilot CLI are all supported in the SDK. Use `client.listModels()` for the runtime-authoritative list. [10]

---

## 5. RuFlo Today (one-screen recap)

RuFlo is a **governed software factory** built as a multi-package v3 monorepo under `/Users/cohen/Projects/ruflo/v3/@claude-flow/`.

**Codex adapter pattern** (`/Users/cohen/Projects/ruflo/v3/@claude-flow/codex/`):
- `package.json` — exports map with `.`, `./generators`, `./templates`, `./migrations`, `./dual-mode`, `./loop`; bin `claude-flow-codex`; peer dep on `@claude-flow/cli` (optional)
- `src/initializer.ts` — `CodexInitializer.initialize()` creates `.agents/config.toml`, `AGENTS.md`, `.codex/`, skill files, registers MCP server via `codex mcp add ruflo`
- `src/dual-mode/orchestrator.ts` — `DualModeOrchestrator` dispatches headless workers as `platform: 'claude' | 'codex'` via `spawn()`; shared memory via `npx ruflo@alpha memory store/search`; dependency-level parallel execution
- `src/loop/index.ts` — `runCodexLoop()` runs iterative autonomous loops with state persistence in `.codex/loop/`
- `src/generators/` — `generateAgentsMd()`, `generateSkillMd()`, `generateConfigToml()`
- `src/migrations/index.ts` — `migrateFromClaudeCode()`, `analyzeClaudeMd()`, `convertSkillSyntax()` (/skill-name → $skill-name)
- `src/validators/index.ts` — `validateAgentsMd()`, `validateSkillMd()`, `validateConfigToml()`

**Governance control plane** (`/Users/cohen/Projects/ruflo/v3/@claude-flow/guidance/src/index.ts`):
- `GuidanceControlPlane` orchestrates: `GuidanceCompiler` (CLAUDE.md → `PolicyBundle`), `ShardRetriever` (HNSW shard lookup), `EnforcementGates` (hook gates: destructive ops, tool allowlist, diff size, secrets), `RunLedger` (run logging + evaluators), `OptimizerLoop` (rule evolution via A/B), `HeadlessRunner` (automated testing)
- The four verbs are: **compile** (CLAUDE.md → constitution + shards), **enforce** (gate every tool call), **prove** (ledger + proof chain), **evolve** (optimizer promotes local rules to root)

**Dual-mode orchestrator** (`DualModeOrchestrator`): spawns headless `claude -p` and `codex exec` workers in dependency-level groups, coordinates via shared AgentDB memory namespace `collaboration`.

**Hooks + memory bridge**: `pre-task`, `post-task`, `post-edit`, `route` hooks from `@claude-flow/hooks` fire automatically via `npx @claude-flow/cli@latest hooks <hook>`. Cost tracking (`cost-track`) reads session JSONL and stores to `cost-tracking` namespace. Neural learning (`train-neural`) stores patterns to AgentDB.

**`/loop` runner**: `runCodexLoop()` in `src/loop/index.ts` manages iterative autonomous runs with state in `.codex/loop/`, stop-file sentinel (`<name>.stop`), completion-file sentinel (`<name>.complete`).

---

## 6. Proposed Package: `@claude-flow/copilot`

### 6.1 Directory Layout

```
v3/@claude-flow/copilot/
├── package.json                  # mirrors codex exactly (see 6.2)
├── tsconfig.json                 # same as codex tsconfig
├── vitest.config.ts              # same as codex
├── README.md                     # (only if user requests)
├── AGENTS.md                     # Copilot-flavored AGENTS.md for the package itself
├── src/
│   ├── index.ts                  # mirrors codex/src/index.ts re-export shape
│   ├── types.ts                  # all Copilot-specific types (mirrors codex types.ts)
│   ├── initializer.ts            # CopilotInitializer + initializeCopilotProject
│   ├── cli.ts                    # claude-flow-copilot bin entry (mirrors codex cli.ts)
│   │
│   ├── client/                   # NEW vs codex — wraps @github/copilot-sdk
│   │   ├── auth.ts               # credential resolution + token cache
│   │   ├── chat.ts               # chat completion with streaming
│   │   ├── tools.ts              # tool/function calling adapter
│   │   └── models.ts             # model catalog + tier mapping + getOptimalModel()
│   │
│   ├── mcp/                      # NEW vs codex — bidirectional MCP bridge
│   │   ├── register.ts           # registers ruflo MCP server WITH Copilot SDK session
│   │   └── bridge.ts             # bridges Copilot MCP tool calls → ruflo MCP tools
│   │
│   ├── dual-mode/                # extends DualModeOrchestrator to tri-mode
│   │   ├── index.ts              # re-exports + MultiModeWorkerConfig
│   │   └── cli.ts                # `claude-flow-copilot dual` subcommand
│   │
│   ├── loop/                     # /loop runner for Copilot platform
│   │   ├── index.ts              # runCopilotLoop() — mirrors runCodexLoop()
│   │   └── cli.ts                # loop subcommand
│   │
│   ├── generators/
│   │   ├── agents-md.ts          # Copilot-flavored AGENTS.md (no $skill syntax needed)
│   │   ├── config-toml.ts        # Copilot config (model defaults, permission handler)
│   │   └── skill-md.ts           # mirrors codex skill-md.ts
│   │
│   ├── templates/
│   │   └── index.ts              # mirrors codex templates/index.ts
│   │
│   ├── migrations/
│   │   └── index.ts              # migrateFromClaudeCode + migrateFromCodex (new)
│   │
│   └── validators/
│       └── index.ts              # validateAgentsMd, validateSkillMd, validateConfig
│
└── tests/
    ├── client/                   # mock @github/copilot-sdk
    ├── mcp/                      # mock ruflo MCP server
    ├── dual-mode/                # multi-mode orchestrator integration
    └── e2e/                      # gated behind COPILOT_E2E=1
```

**Justification for net-new subfolders:**
- `client/` — codex has no equivalent because Codex CLI is invoked as a subprocess with no JS SDK. Copilot SDK provides a proper TypeScript client library that must be wrapped for RuFlo's governance and hook wiring.
- `mcp/` — codex's MCP registration is a single `execSync('codex mcp add ruflo ...')` call inside `initializer.ts`. Copilot SDK has a richer bidirectional MCP model (SDK exposes tools TO Copilot; Copilot calls them during sessions) requiring a dedicated bridge module.
- Everything else (`dual-mode/`, `loop/`, `generators/`, `templates/`, `migrations/`, `validators/`) mirrors codex exactly for structural consistency.

### 6.2 package.json Shape

```json
{
  "name": "@claude-flow/copilot",
  "version": "3.8.0",
  "description": "GitHub Copilot SDK integration for RuFlo (claude-flow) — Copilot platform adapter",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "claude-flow-copilot": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./client": {
      "types": "./dist/client/index.d.ts",
      "import": "./dist/client/index.js",
      "require": "./dist/client/index.js"
    },
    "./mcp": {
      "types": "./dist/mcp/index.d.ts",
      "import": "./dist/mcp/index.js",
      "require": "./dist/mcp/index.js"
    },
    "./generators": {
      "types": "./dist/generators/index.d.ts",
      "import": "./dist/generators/index.js",
      "require": "./dist/generators/index.js"
    },
    "./templates": {
      "types": "./dist/templates/index.d.ts",
      "import": "./dist/templates/index.js",
      "require": "./dist/templates/index.js"
    },
    "./migrations": {
      "types": "./dist/migrations/index.d.ts",
      "import": "./dist/migrations/index.js",
      "require": "./dist/migrations/index.js"
    },
    "./dual-mode": {
      "types": "./dist/dual-mode/index.d.ts",
      "import": "./dist/dual-mode/index.js",
      "require": "./dist/dual-mode/index.js"
    },
    "./loop": {
      "types": "./dist/loop/index.d.ts",
      "import": "./dist/loop/index.js",
      "require": "./dist/loop/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "eslint src --ext .ts",
    "test": "vitest",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["copilot", "github", "claude-flow", "ruflo", "agents", "skills", "AGENTS.md", "agentic-ai"],
  "author": "rUv",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/ruvnet/ruflo.git",
    "directory": "v3/@claude-flow/copilot"
  },
  "homepage": "https://github.com/ruvnet/ruflo#readme",
  "bugs": { "url": "https://github.com/ruvnet/ruflo/issues" },
  "engines": { "node": ">=20" },
  "dependencies": {
    "@github/copilot-sdk": "^1.0.0",
    "commander": "^12.0.0",
    "fs-extra": "^11.2.0",
    "chalk": "^5.3.0",
    "inquirer": "^9.2.0",
    "yaml": "^2.4.0",
    "toml": "^3.0.0",
    "@iarna/toml": "^2.2.5"
  },
  "peerDependencies": {
    "@claude-flow/cli": "^3.0.0",
    "@claude-flow/guidance": "^3.0.0"
  },
  "peerDependenciesMeta": {
    "@claude-flow/cli": { "optional": true },
    "@claude-flow/guidance": { "optional": true }
  },
  "devDependencies": {
    "@types/fs-extra": "^11.0.4",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^4.0.16",
    "eslint": "^8.57.0"
  }
}
```

**Version rationale:** The codex package is at `3.0.0-alpha.9`. Per the `CLAUDE.md` memory rule: "from 3.7.0 onward publish stable semver; alpha series ended 2026-05-23." Since this is a wholly new package shipping after the alpha cutoff, it should enter as **`3.8.0`** (MINOR bump from 3.7.x line) rather than any alpha. The `alpha` and `v3alpha` dist-tags should point at this version for backward compat. Note: `@github/copilot-sdk` is a **direct dependency** (not peer/optional) because the whole package's value proposition depends on it.

**Engines change vs codex:** Codex requires Node 18+. Copilot SDK requires Node 20+. This package bumps the engine floor to `>=20`.

### 6.3 Public API Surface (`src/index.ts`)

```typescript
/**
 * @claude-flow/copilot
 *
 * GitHub Copilot SDK platform adapter for Claude Flow / RuFlo
 * Third platform in the tri-mode collaboration system (Claude + Codex + Copilot)
 */

// Re-export all types
export * from './types.js';

// Re-export generators
export {
  generateAgentsMd,
  generateSkillMd,
  generateConfigToml,
} from './generators/index.js';

// Re-export migrations
export {
  migrateFromClaudeCode,
  migrateFromCodex,
  analyzeClaudeMd,
  generateMigrationReport,
  convertSkillSyntax,
  convertSettingsToConfig,
  FEATURE_MAPPINGS,
  CODEX_TO_COPILOT_MAPPINGS,
} from './migrations/index.js';

// Re-export validators
export {
  validateAgentsMd,
  validateSkillMd,
  validateConfig,
} from './validators/index.js';

// Main initializer
export { CopilotInitializer, initializeCopilotProject } from './initializer.js';

// Copilot client (wraps @github/copilot-sdk)
export { CopilotClient, createCopilotClient } from './client/chat.js';
export { resolveCredential, getCachedToken, clearCachedToken } from './client/auth.js';
export { getOptimalModel, COPILOT_MODEL_CATALOG, TIER_DEFAULTS } from './client/models.js';
export { defineCopilotTool, CopilotToolRegistry } from './client/tools.js';
export type {
  CopilotClientConfig,
  CopilotSession,
  CopilotMessage,
  StreamEvent,
  CopilotTool,
} from './client/chat.js';

// MCP bridge (bidirectional)
export {
  registerRufloMcpWithCopilot,
  CopilotMcpBridge,
} from './mcp/register.js';
export type { RufloMcpServerConfig, CopilotMcpSession } from './mcp/register.js';

// Tri-mode collaboration (extends DualModeOrchestrator)
export {
  MultiModeOrchestrator,
  TriModeCollaborationTemplates,
  createMultiModeCommand,
} from './dual-mode/index.js';
export type {
  MultiModeConfig,
  MultiModeWorkerConfig,
  MultiModeWorkerResult,
  CollaborationResult,
} from './dual-mode/index.js';

// /loop runner
export {
  buildCopilotLoopPrompt,
  loadLoopState,
  normalizeLoopName,
  requestLoopStop,
  resolveLoopPaths,
  runCopilotLoop,
} from './loop/index.js';
export { createLoopCommand } from './loop/cli.js';
export type {
  LoopCommandResult,
  LoopEvent,
  LoopPaths,
  LoopRunOptions,
  LoopState,
} from './loop/index.js';

// Template utilities (mirrors codex)
export {
  getTemplate,
  listTemplates,
  BUILT_IN_SKILLS,
  TEMPLATES,
  DEFAULT_SKILLS_BY_TEMPLATE,
  DIRECTORY_STRUCTURE,
  PLATFORM_MAPPING,
  GITIGNORE_ENTRIES,
  AGENTS_OVERRIDE_TEMPLATE,
} from './templates/index.js';

export const VERSION = '3.8.0';

export const PACKAGE_INFO = {
  name: '@claude-flow/copilot',
  version: VERSION,
  description: 'GitHub Copilot SDK integration for Claude Flow / RuFlo',
  platform: 'copilot',
  repository: 'https://github.com/ruvnet/ruflo',
} as const;

export default { VERSION, PACKAGE_INFO };
```

### 6.4 Tri-Mode Collaboration

**Design choice: extend, not rename.** Renaming `DualModeOrchestrator` to `MultiModeOrchestrator` would be a breaking change for all existing code importing from `@claude-flow/codex/dual-mode`. Instead, `@claude-flow/copilot` introduces `MultiModeOrchestrator` that extends `DualModeOrchestrator`, adding `copilot` as a third platform value.

**Diff to `WorkerConfig` in `orchestrator.ts`:**

```diff
// In @claude-flow/codex/src/dual-mode/orchestrator.ts (existing):
 export interface WorkerConfig {
   id: string;
-  platform: 'claude' | 'codex';
+  platform: 'claude' | 'codex' | 'copilot';  // ← ADD copilot
   role: string;
   prompt: string;
   model?: string;
   ...
 }
```

However, to avoid modifying the codex package, `@claude-flow/copilot` re-declares and widens the type locally:

```typescript
// src/dual-mode/index.ts in @claude-flow/copilot:
import { DualModeOrchestrator, WorkerConfig as BaseWorkerConfig } from '@claude-flow/codex/dual-mode';

export interface MultiModeWorkerConfig extends Omit<BaseWorkerConfig, 'platform'> {
  platform: 'claude' | 'codex' | 'copilot';
  copilotModel?: string;   // e.g. 'gpt-5.3-codex' | 'gpt-5.5'
  copilotOptions?: {
    permissionHandler?: 'approve-all' | 'deny-all' | 'custom';
    streaming?: boolean;
    mcpServers?: Record<string, unknown>;
  };
}

export class MultiModeOrchestrator extends DualModeOrchestrator {
  protected async executeHeadless(config: MultiModeWorkerConfig): Promise<string> {
    if (config.platform === 'copilot') {
      return this.executeCopilotHeadless(config);
    }
    return super.executeHeadless(config as BaseWorkerConfig);
  }

  private async executeCopilotHeadless(config: MultiModeWorkerConfig): Promise<string> {
    const { CopilotClient } = await import('../client/chat.js');
    const { getOptimalModel } = await import('../client/models.js');
    const { registerRufloMcpWithCopilot } = await import('../mcp/register.js');
    const { GuidanceControlPlane } = await import('@claude-flow/guidance');

    const guidance = new GuidanceControlPlane();
    await guidance.initialize();

    const prompt = this.buildCollaborativePrompt(config);
    const compiled = await guidance.compile(prompt);

    const client = new CopilotClient();
    const session = await client.createSession({
      model: config.copilotModel ?? getOptimalModel('Tier3'),
      streaming: config.copilotOptions?.streaming ?? false,
      mcpServers: await registerRufloMcpWithCopilot(this.config.projectPath),
    });

    const result = await session.sendAndWait({ prompt: compiled.policyText + '\n\n' + prompt });
    await session.disconnect();
    await client.stop();

    await guidance.finalizeRun(guidance.startRun(config.id, 'feature'));
    return result.content ?? '';
  }
}
```

**Tri-mode collaboration template:**

```typescript
// TriModeCollaborationTemplates in src/dual-mode/index.ts:
export const TriModeCollaborationTemplates = {
  featureDevelopment: (feature: string): MultiModeWorkerConfig[] => [
    {
      id: 'architect',
      platform: 'claude',          // 🔵 Claude: architecture reasoning
      role: 'architect',
      prompt: `Design the architecture for: ${feature}. Define components, interfaces, data flow.`,
      maxTurns: 10,
    },
    {
      id: 'coder',
      platform: 'codex',           // 🟢 Codex: bulk implementation
      role: 'coder',
      prompt: `Implement the feature based on the architecture. Write clean, typed code.`,
      dependsOn: ['architect'],
      maxTurns: 15,
    },
    {
      id: 'reviewer',
      platform: 'copilot',         // 🟠 Copilot (GPT-5.3-Codex): code review
      role: 'reviewer',
      prompt: `Review the code and tests for quality, security, and best practices.`,
      dependsOn: ['coder'],
      copilotModel: 'gpt-5.3-codex',
    },
    {
      id: 'tester',
      platform: 'claude',          // 🔵 Claude: test strategy
      role: 'tester',
      prompt: `Write comprehensive tests. Target 80% coverage.`,
      dependsOn: ['reviewer'],
      maxTurns: 10,
    },
  ],

  securityAudit: (target: string): MultiModeWorkerConfig[] => [
    {
      id: 'scanner',
      platform: 'copilot',         // 🟠 Copilot GPT-5.5: deep security analysis
      role: 'security-scanner',
      prompt: `Scan ${target} for security vulnerabilities. Check OWASP Top 10.`,
      copilotModel: 'gpt-5.5',    // frontier model for security reasoning
      copilotOptions: { streaming: false },
    },
    {
      id: 'fixer',
      platform: 'codex',           // 🟢 Codex: generate fixes
      role: 'security-fixer',
      prompt: `Generate fixes for identified vulnerabilities.`,
      dependsOn: ['scanner'],
      maxTurns: 12,
    },
  ],
};
```

### 6.5 Governance Integration

Every Copilot call in `@claude-flow/copilot` goes through the four governance verbs of `@claude-flow/guidance`:

**Compile:** Prompts are compiled through `GuidanceControlPlane.compile()` before being sent to Copilot. The compiler extracts the `PolicyBundle` (constitution + relevant shards) and prepends it to the prompt. This ensures behavioral non-negotiables (never commit secrets, never overwrite without validation, etc.) are injected into every Copilot session. [7]

**Enforce:** `EnforcementGates.evaluateToolUse()` is called before each Copilot tool invocation. If a gate returns `'block'`, the tool call is rejected and the ledger records a violation. [7]

**Prove:** `RunLedger` logs every Copilot session as a `RunEvent` with: tools used, files touched, diff summary, violations, outcome. `ProofChain` in `@claude-flow/guidance` generates a cryptographic proof envelope for the session. [7]

**Evolve:** After enough run events accumulate, `OptimizerLoop.runCycle()` proposes rule changes (A/B tested) and promotes winning rules from `CLAUDE.local.md` to `CLAUDE.md`. [7]

**Hook wiring — the pre/post lifecycle:**

```typescript
// In CopilotClient.runGoverned() (src/client/chat.ts):
async runGoverned(prompt: string, taskId: string): Promise<string> {
  // 1. pre-task hook (same as codex/claude adapters)
  await execa('npx', ['@claude-flow/cli@latest', 'hooks', 'pre-task',
    '--description', prompt, '--coordinate-swarm']);

  // 2. route hook — get model recommendation
  const routeResult = await execa('npx', ['@claude-flow/cli@latest', 'hooks', 'route',
    '--task', prompt, '--context', 'copilot']);
  const model = extractModelFromRoute(routeResult.stdout) ?? TIER_DEFAULTS.tier3;

  // 3. guidance compile
  const guidance = await initializeGuidanceControlPlane();
  const { policyText } = await guidance.retrieveForTask({ taskDescription: prompt });

  // 4. Copilot call (with governance-compiled prompt)
  const result = await this.session.sendAndWait({
    prompt: `${policyText}\n\n---\n\n${prompt}`
  });

  // 5. post-task hook (learning + cost tracking)
  await execa('npx', ['@claude-flow/cli@latest', 'hooks', 'post-task',
    '--task-id', taskId, '--success', 'true', '--store-results', 'true']);

  // 6. finalize governance proof
  const event = guidance.startRun(taskId, 'feature');
  await guidance.finalizeRun(event);

  return result.content ?? '';
}
```

The hooks used are those named in `CLAUDE.md`: `pre-task`, `route`, `post-task`, `post-edit`. The `route` hook response may include `[CODEMOD_AVAILABLE]` (Tier 1, bypass LLM) or `[TASK_MODEL_RECOMMENDATION] Use model="gpt-5.4-mini"` (Tier 2 fast). [8]

### 6.6 Model Routing

The 3-tier routing table updated for the Copilot adapter:

| Tier | Handler | Latency | Cost | Copilot Model | Use Cases |
|------|---------|---------|------|---------------|-----------|
| **1** | Deterministic codemod | ~1ms | $0 | N/A (no LLM) | `var-to-const`, `remove-console`, `add-logging` |
| **2** | Copilot GPT-5.4-mini | ~500ms | 0.33x credits | `gpt-5.4-mini` | Simple tasks, low complexity (<30%) |
| **3a** | Copilot GPT-5.3-Codex | 2-5s | 1x credits | `gpt-5.3-codex` | Architecture, code generation, security (>30%) |
| **3b** | Copilot GPT-5.5 | 5-15s | 7.5x credits | `gpt-5.5` | Complex reasoning, frontier tasks (explicit opt-in) |

**`src/client/models.ts` — `getOptimalModel()`:**

```typescript
export const COPILOT_MODEL_CATALOG = {
  'gpt-5.3-codex': { tier: 3, multiplier: 1.0,  category: 'coding-lts',   ltsUntil: '2027-02-04' },
  'gpt-5.4-mini':  { tier: 2, multiplier: 0.33, category: 'fast',         ltsUntil: null },
  'gpt-5.5':       { tier: 3, multiplier: 7.5,  category: 'frontier',     ltsUntil: null },
  // Runtime-authoritative list via client.listModels()
} as const;

export const TIER_DEFAULTS = {
  tier2: 'gpt-5.4-mini',
  tier3: 'gpt-5.3-codex',
  tier3Reasoning: 'gpt-5.5',
} as const;

/**
 * Select the optimal Copilot model for a given task complexity score.
 * complexity: 0-100 where 0=trivial codemod, 100=frontier reasoning
 */
export function getOptimalModel(
  complexityOrTier: number | 'Tier2' | 'Tier3' | 'Tier3Reasoning',
  allowFrontier = false
): string {
  if (typeof complexityOrTier === 'string') {
    if (complexityOrTier === 'Tier2') return TIER_DEFAULTS.tier2;
    if (complexityOrTier === 'Tier3Reasoning' && allowFrontier) return TIER_DEFAULTS.tier3Reasoning;
    return TIER_DEFAULTS.tier3;
  }
  const c = complexityOrTier;
  if (c < 30) return TIER_DEFAULTS.tier2;
  if (c >= 80 && allowFrontier) return TIER_DEFAULTS.tier3Reasoning;
  return TIER_DEFAULTS.tier3;
}
```

### 6.7 Auth + Secrets

**Device flow:** The Copilot CLI handles auth transparently. The SDK picks up credentials from env vars or stored `gh auth login` state. There is no need to prompt the user for a token in `@claude-flow/copilot`. [10]

**Token cache in `src/client/auth.ts`:**

```typescript
import { TokenCache } from '@claude-flow/security';  // existing module

export async function resolveCredential(): Promise<string | null> {
  // 1. Check environment (COPILOT_GITHUB_TOKEN, GH_TOKEN, GITHUB_TOKEN) — SDK picks these up natively
  // 2. Verify CLI is authenticated
  const { execa } = await import('execa');
  try {
    await execa('gh', ['auth', 'status'], { stdio: 'pipe' });
    return 'gh-auth';  // CLI is authenticated; SDK will use stored credential
  } catch {
    return null;  // Not authenticated — surface error to user
  }
}

// NEVER echo the token. NEVER write it to a file.
// The SDK reads credentials itself; auth.ts only VERIFIES that auth state exists.
export async function getCachedToken(): Promise<string | null> {
  // TokenCache from @claude-flow/security stores opaque handles, not raw tokens
  return TokenCache.get('copilot-auth-status');
}

export async function clearCachedToken(): Promise<void> {
  return TokenCache.clear('copilot-auth-status');
}
```

**Note on `@claude-flow/security` TokenCache:** The module exists at `/Users/cohen/Projects/ruflo/v3/@claude-flow/security/` [5]. Whether it exports a `TokenCache` class is [unverified — not read in this session]. If it does not exist, this becomes a follow-up: implement token handle storage using the existing `InputValidator` + `PathValidator` primitives, or use Node's keychain via `keytar`. The constraint from user memory is absolute: never print or persist the raw credential value. [8]

### 6.8 MCP Wiring (Both Directions)

**Direction A — Copilot calls INTO RuFlo MCP (tools available to Copilot agents):**

This is the primary direction. When a Copilot session is created, RuFlo's MCP server is registered so that Copilot agents can call `memory_store`, `memory_search`, `swarm_init`, `hooks_route`, etc. directly.

```typescript
// src/mcp/register.ts
import { CopilotClient } from '@github/copilot-sdk';

export interface RufloMcpServerConfig {
  type: 'local';
  command: 'npx';
  args: ['-y', 'ruflo@latest', 'mcp', 'start'];
  tools: ['*'];  // expose all ruflo MCP tools to Copilot
  env?: Record<string, string>;
}

export async function registerRufloMcpWithCopilot(
  projectPath: string,
  toolFilter: string[] | '*' = '*'
): Promise<Record<string, RufloMcpServerConfig>> {
  return {
    ruflo: {
      type: 'local',
      command: 'npx',
      args: ['-y', 'ruflo@latest', 'mcp', 'start'],
      tools: toolFilter === '*' ? ['*'] : toolFilter,
      env: { CLAUDE_FLOW_CONFIG: `${projectPath}/claude-flow.config.json` },
    }
  };
}
```

Usage in session creation [9]:
```typescript
const session = await client.createSession({
  model: 'gpt-5.3-codex',
  mcpServers: await registerRufloMcpWithCopilot(process.cwd()),
});
```

**Direction B — RuFlo calls Copilot SDK from within governed workflows:**

This is the `CopilotClient.runGoverned()` path shown in Section 6.5. The SDK spawns the Copilot CLI, sends the compiled prompt, and returns the response. All governance hooks fire. The call is synchronous from RuFlo's perspective.

**MCP spec revision note:** The GitHub Copilot SDK documentation does not state which MCP spec revision it conforms to. The stdio/HTTP transports and tool-filter array pattern are consistent with MCP 2024-11-05 (the most widely adopted draft as of mid-2026). Until GitHub documents the revision explicitly, treat this as [unverified]. [9]

**Client-side vs server-side (answered from docs):** MCP servers run **client-side** as subprocesses on the user's machine. The Copilot backend does not execute MCP tools. This is architecturally important: RuFlo's MCP server can safely access local filesystem, AgentDB, and hooks because it runs in the user's environment. [9]

### 6.9 Test Strategy

**Philosophy:** TDD London School (mock-first), as required by all v3 packages. [5][8]

```
tests/
├── client/
│   ├── auth.test.ts          # mock gh CLI + env vars; test resolveCredential()
│   ├── chat.test.ts          # mock @github/copilot-sdk CopilotClient; test streaming + non-streaming
│   ├── models.test.ts        # unit test getOptimalModel() at complexity boundaries
│   └── tools.test.ts         # test tool registration shape against SDK contract
│
├── mcp/
│   ├── register.test.ts      # verify RufloMcpServerConfig shape is valid SDK input
│   └── bridge.test.ts        # mock ruflo MCP server; test tool call routing
│
├── dual-mode/
│   └── orchestrator.test.ts  # mock claude + codex + copilot workers; test dependency levels
│
├── generators/
│   ├── agents-md.test.ts     # snapshot tests for generated AGENTS.md
│   └── config-toml.test.ts   # snapshot tests for generated config
│
├── migrations/
│   └── migration.test.ts     # test migrateFromClaudeCode + migrateFromCodex
│
└── e2e/
    └── copilot-session.test.ts  # COPILOT_E2E=1 required; real SDK call; costs AI credits
```

**Mock pattern for `@github/copilot-sdk`** (mirrors codex mock of `claude` subprocess):

```typescript
// tests/__mocks__/@github/copilot-sdk.ts
export class CopilotClient {
  async createSession() {
    return {
      sendAndWait: async ({ prompt }: { prompt: string }) => ({
        content: `Mock Copilot response to: ${prompt.slice(0, 50)}`,
        model: 'gpt-5.3-codex',
      }),
      disconnect: async () => {},
    };
  }
  async stop() {}
}
```

**E2E gate:** Real Copilot sessions consume AI credits. Gate behind `COPILOT_E2E=1`:
```typescript
// tests/e2e/copilot-session.test.ts
const runE2E = process.env.COPILOT_E2E === '1';
(runE2E ? it : it.skip)('sends a real prompt to Copilot', async () => { ... });
```

---

## 7. Publishing & Dist-Tag Plan

Per the user's memory rule: "from 3.7.0 onward publish stable semver; alpha series ended 2026-05-23." [8]

```bash
# STEP 1: Build and publish @claude-flow/copilot (new package, first publish)
cd v3/@claude-flow/copilot
npm version 3.8.0 --no-git-tag-version
npm run build
npm publish                                       # default tag is latest
npm dist-tag add @claude-flow/copilot@3.8.0 alpha
npm dist-tag add @claude-flow/copilot@3.8.0 v3alpha

# STEP 2: Bump umbrella claude-flow (add @claude-flow/copilot as optional dep)
cd /Users/cohen/Projects/ruflo
# Edit package.json: add "@claude-flow/copilot": "^3.8.0" to optionalDependencies
npm version 3.8.0 --no-git-tag-version
npm publish
npm dist-tag add claude-flow@3.8.0 alpha
npm dist-tag add claude-flow@3.8.0 v3alpha

# STEP 3: Bump ruflo wrapper
cd ruflo
npm version 3.8.0 --no-git-tag-version
# Edit package.json: add "@claude-flow/copilot" to optionalDependencies and overrides
npm publish
npm dist-tag add ruflo@3.8.0 alpha
npm dist-tag add ruflo@3.8.0 v3alpha
```

**`npx ruflo init --copilot` wiring:** Add a `--copilot` flag to the `init` command in `@claude-flow/cli` that delegates to `CopilotInitializer.initialize()`. This mirrors how `--codex` delegates to `CodexInitializer`.

**Verification:**
```bash
for pkg in @claude-flow/copilot @claude-flow/cli claude-flow ruflo; do
  echo "$pkg: $(npm view $pkg@latest version)"
  npm view $pkg dist-tags --json
done
# All packages: latest === alpha === v3alpha === new version
```

**GitHub Release:**
```bash
git tag v3.8.0 main
git push origin v3.8.0
gh release create v3.8.0 --title "v3.8.0 — @claude-flow/copilot: GitHub Copilot SDK integration + tri-mode collaboration"
```

---

## 8. Migration Story

### 8.1 From Claude Code to Copilot (mirrors codex `migrateFromClaudeCode`)

| Claude Code artifact | Copilot equivalent | Migration action |
|---------------------|-------------------|-----------------|
| `CLAUDE.md` | `AGENTS.md` | Content is portable; no skill-syntax change needed (Copilot doesn't use `$` or `/` skill syntax) |
| `CLAUDE.local.md` | `.copilot/AGENTS.override.md` | Direct copy |
| `settings.json` | `.copilot/config.json` | JSON → JSON; model field changes to `gpt-5.3-codex` |
| `/skill-name` | No direct equivalent | Skills are MCP tools in Copilot; generate a tool registration for each |
| `hooks system` | MCP tools + session events | Hook-equivalent behavior via `session.on('session.idle', ...)` |
| MCP servers | `mcpServers` in session config | Configuration format changes; same underlying functionality |
| `TodoWrite` | No equivalent | Use session tool calls with custom task-tracking tool |

**`migrateFromClaudeCode()` in `src/migrations/index.ts`** follows the same structure as the codex migration: parse CLAUDE.md, extract sections/skills/MCP servers/settings, generate AGENTS.md + config.json + MCP tool stubs.

### 8.2 From Codex to Copilot (new — not in codex package)

| Codex artifact | Copilot equivalent | Delta |
|---|---|---|
| `AGENTS.md` | `AGENTS.md` | Content compatible; no change needed |
| `.agents/config.toml` | `.copilot/config.json` | TOML → JSON; `model = "gpt-5.3-codex"`, `approval_policy` → custom `permissionHandler` |
| `$skill-name` | MCP tool call | Each skill becomes a registered MCP tool; `defineCopilotTool(skillName, ...)` |
| `[mcp_servers.ruflo]` | `mcpServers.ruflo` in session config | Same underlying ruflo MCP server; config syntax changes from TOML table to JS object |
| `.codex/loop/` state dir | `.copilot/loop/` state dir | Same state schema; `mode: 'codex'` → `mode: 'copilot'` |
| `codex exec` subprocess | SDK `session.sendAndWait()` | No subprocess; direct SDK call (latency improvement expected) |
| `approval_policy: "never"` | `permissionHandler: 'approve-all'` | Semantic equivalent; implementation differs |
| `sandbox_mode: "workspace-write"` | No direct SDK equivalent | Copilot CLI sandbox controls via CLI flags, not SDK session config |

**`migrateFromCodex()` in `src/migrations/index.ts`:**

```typescript
export async function migrateFromCodex(options: MigrationOptions): Promise<MigrationResult> {
  // 1. Read .agents/config.toml
  // 2. Parse TOML model, approval_policy, sandbox_mode, mcp_servers, skills
  // 3. Generate .copilot/config.json with Copilot SDK equivalents
  // 4. For each [skills] entry: generate a CopilotTool registration stub
  // 5. Convert $skill-name references in AGENTS.md to MCP tool call comments
  // 6. Migrate .codex/loop/ state dir to .copilot/loop/ (mode: 'copilot')
  // 7. Return warnings for: sandbox_mode (no direct equiv), approval_policy differences
}
```

**Key differences to warn about:**
- Codex `approval_policy: "on-request"` has no direct Copilot SDK equivalent; map to `permissionHandler: 'custom'` with a prompt-based approval.
- Codex `sandbox_mode` is a CLI-level concept; Copilot SDK exposes no file-system sandboxing at the session level.
- Codex skills (`$skill-name`) are SKILL.md files; Copilot has no SKILL.md format. Skills must be re-expressed as MCP tool registrations.

---

## 9. Risks & Open Questions

| # | Risk / Question | Severity | What Resolves It |
|---|----------------|----------|-----------------|
| 1 | **Copilot ToS on programmatic 3rd-party CLI access** | High | The GA announcement explicitly lists 3rd-party tool embedding as an intended use case. MIT license confirmed. No ToS prohibition found. **Risk is LOW** — but read the full GitHub ToS (`github.com/site/terms`) before shipping. |
| 2 | **Streaming tool calls** | Medium | Not mentioned in MCP docs. The `session.on('assistant.message_delta')` event streams text, but whether tool-call invocations are streamed (delta events per tool call) is undocumented. If not supported, all tool calls are synchronous which impacts latency. Test against real SDK. |
| 3 | **Model picker: per-request or per-session?** | Medium | The `model` field is set at session creation (`createSession({ model: '...' })`). This implies per-session, not per-request. If a workflow needs to switch models mid-session (e.g., Tier 2 for simple subtasks, Tier 3 for complex ones), a new session must be created per tier switch. |
| 4 | **Client-side vs server-side MCP (ANSWERED)** | Resolved | MCP servers run client-side as local subprocesses or remote HTTP. The Copilot backend does NOT execute MCP tools. RuFlo's MCP server safely accesses local AgentDB and hooks. [9] |
| 5 | **Rate-limit visibility** | High | The SDK documentation does not describe whether rate-limit or usage headers are returned from `sendAndWait()`. If not available, cost-tracking must rely on token counting at the application level (count prompt + response tokens, multiply by model rate). Contact GitHub SDK team or check API response headers empirically. |
| 6 | **Non-GA (preview) model selection via SDK** | Medium | The catalog shows Raptor mini, Gemini 3 Flash, Claude Opus 4.6 (fast mode) as preview. Whether SDK callers can request these models directly, or whether admin approval is required per-organization, is unclear. The changelog says admins must enable GPT-5.5; presumably the same applies to other preview models. |
| 7 | **`@claude-flow/security` TokenCache API** | Low | The `TokenCache` import in `auth.ts` assumes the security package exports this class. Read `/Users/cohen/Projects/ruflo/v3/@claude-flow/security/` src before implementing auth.ts. If absent, implement using Node `keytar` or a simple encrypted file store. |
| 8 | **Exact npm version of `@github/copilot-sdk`** | Low | npm registry returned 403. Version `1.0.0-beta.12` from search results. Confirm by running `npm view @github/copilot-sdk` in a CI environment and pin in package.json once confirmed. |
| 9 | **MCP spec revision** | Low | No version number cited in GitHub docs. Empirically match the SDK's tool-call schema against MCP spec revisions (2024-11-05 or later) to confirm compatibility with `@modelcontextprotocol/sdk`. |

---

## 10. Recommended Next Steps (Ordered)

1. **Read `/Users/cohen/Projects/ruflo/v3/@claude-flow/security/src/index.ts`** to confirm `TokenCache` API exists; if not, design the auth token handle storage in a follow-up ADR.

2. **Confirm npm package version:** Run `npm view @github/copilot-sdk` in a clean environment to get exact version, install size, and full dependency list. Pin `@github/copilot-sdk` to exact major in `package.json` (`"@github/copilot-sdk": "^1.0.0"`).

3. **Scaffold `v3/@claude-flow/copilot/` skeleton:** Create `package.json`, `tsconfig.json`, `vitest.config.ts` from codex counterparts. Create empty `src/` subdirectory tree. No implementation yet — just structure so `npm run build` succeeds with empty stubs.

4. **Implement `src/client/models.ts`** first (no external dependencies, pure logic). Write unit tests for `getOptimalModel()`. Confirm model ID strings (`gpt-5.3-codex`, `gpt-5.4-mini`, `gpt-5.5`) against a live `client.listModels()` call once the SDK is installed.

5. **Implement `src/client/auth.ts`** with mock-first tests. Verify that `gh auth status` exits 0 on an authenticated machine and non-zero otherwise.

6. **Implement `src/client/chat.ts`** wrapping `CopilotClient` + `GuidanceControlPlane`. Write vitest mock tests. Wire `runGoverned()` with all four hook calls (`pre-task`, `route`, Copilot session, `post-task`).

7. **Implement `src/mcp/register.ts` and `bridge.ts`**. Write mock tests verifying the `mcpServers` object shape matches the SDK's session config. Run against a real `ruflo mcp start` process in an integration test (gated behind `MCP_INTEGRATION=1`).

8. **Implement `src/dual-mode/index.ts` (MultiModeOrchestrator)**. Extend `DualModeOrchestrator`. Add `copilot:` worker dispatch. Write orchestrator integration tests with all three platforms mocked.

9. **Implement `src/initializer.ts` (CopilotInitializer)**. Mirror `CodexInitializer` exactly, replacing `codex mcp add` with the SDK session registration. Add `--copilot` flag to `@claude-flow/cli` `init` command.

10. **Publish `@claude-flow/copilot@3.8.0`** following the three-package publishing protocol (cli → claude-flow → ruflo). Update all dist-tags. Create GitHub release `v3.8.0`. Verify with `npx ruflo init --copilot` in a fresh directory.

---

## 11. References

1. https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started (fetched 2026-06-03)
2. https://github.blog/changelog/2026-06-02-copilot-sdk-is-now-generally-available/ (fetched 2026-06-03)
3. https://github.blog/changelog/2026-05-17-gpt-5-3-codex-is-now-the-base-model-for-copilot-business-and-enterprise/ (fetched 2026-06-03)
4. https://github.blog/changelog/2026-04-24-gpt-5-5-is-generally-available-for-github-copilot/ (fetched 2026-06-03)
5. Local: /Users/cohen/Projects/ruflo/v3/@claude-flow/codex/ (read 2026-06-03)
6. https://docs.github.com/en/copilot/reference/ai-models/supported-models (fetched 2026-06-03)
7. Local: /Users/cohen/Projects/ruflo/v3/@claude-flow/guidance/src/index.ts (read 2026-06-03)
8. Local: /Users/cohen/Projects/ruflo/CLAUDE.md (read 2026-06-03)
9. https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/mcp (fetched 2026-06-03)
10. https://github.com/github/copilot-sdk (fetched 2026-06-03)
11. https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing (fetched 2026-06-03)
12. https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models (fetched 2026-06-03)
13. https://www.npmjs.com/package/@github/copilot-sdk (403 blocked; version via web search 2026-06-03)
14. https://github.blog/changelog/2026-05-20-updates-to-available-models-in-copilot-on-web/ (fetched 2026-06-03)
15. https://docs.github.com/en/copilot/reference/ai-models/model-comparison (fetched 2026-06-03)
16. https://github.blog/news-insights/product-news/github-copilot-app-the-agent-native-desktop-experience/ (fetched 2026-06-03)
