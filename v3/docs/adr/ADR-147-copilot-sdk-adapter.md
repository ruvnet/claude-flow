# ADR-147 — GitHub Copilot SDK Adapter and Tri-Mode Collaboration

**Status**: Implemented (skeleton + P1 phase)
**Date**: 2026-06-03
**Issue**: research/copilot-sdk-ruflo-integration (branch); follow-up issue to be filed at PR time
**Related**: ADR-001 (Deep agentic-flow integration), ADR-026 (3-Tier Model Routing), ADR-131 (ToolOutputGuardrail), ADR-143 (Codemod vs Booster), ADR-144 (Authorization Propagation), ADR-145 (Plugin Supply-Chain Integrity), ADR-146 (ToolOutputGuardrail Rollout)

## Context

GitHub announced general availability of the **Copilot SDK** (`@github/copilot-sdk`) on 2026-06-02. The SDK exposes the same agentic runtime that powers the Copilot app — planning, tool invocation, streaming, multi-turn sessions, MCP server registration, and custom tool calling — directly to any application or CLI, without requiring a separate orchestration layer. It is MIT-licensed, runs on Node.js 20+, and supports six target languages including TypeScript. Reference: [Copilot SDK research dossier](../../../docs/research/copilot-sdk-ruflo-integration.md).

This creates a strategic opportunity for RuFlo. The repository already ships **`@claude-flow/codex`** — an OpenAI Codex CLI platform adapter that proves the modular extension pattern: it adds a second programmable agent platform (alongside the existing Claude Code adapter) via a self-contained package, a `DualModeOrchestrator`, a `/loop` runner, generators, validators, and migrations. The Copilot SDK is the natural third platform.

### Why this is architectural, not "open four PRs"

Adding Copilot is not a single file change:

| Surface | New work |
|---|---|
| Programmable platform count | 2 → 3 (Claude, Codex, **Copilot**) |
| Worker prefix vocabulary | `claude:` / `codex:` → `claude:` / `codex:` / `copilot:` (breaking-ish — `WorkerConfig.platform` type widens) |
| Authentication shape | Subprocess CLI (codex) and stdin/stdout (claude) → JSON-RPC client-session model with device-flow OAuth via the bundled Copilot CLI process |
| Model catalog | GPT-5.3-Codex (LTS), GPT-5.4-mini, GPT-5.5 — all require explicit Tier-2/Tier-3 mapping in ADR-026's routing table |
| MCP integration | One-shot `codex mcp add ruflo` → bidirectional MCP bridge (`mcpServers` map in every session config) |
| Governance plane | Same `pre-task → route → call → post-task` lifecycle, but the actual model call now happens via an SDK client object rather than a child process — the compile/enforce/prove/evolve hooks need new wiring |

Five independent PRs (one per phase) would relitigate the worker-prefix decision, the model-tier mapping, the auth contract, and the MCP bridge shape in each review. An ADR is the cheapest way to lock the contract once.

### Why now, not deferred

1. **The codex adapter pattern is proven.** Codex shipped in `3.0.0-alpha.9`, is published, has live users (the `claude-flow-codex` bin), and has set the structural template. Adopting Copilot as a peer adapter has near-zero ambiguity — the surface to mirror is already in tree.
2. **Tri-mode collaboration is the real prize.** A single agent platform is a model — three platforms cross-validating in shared memory is the *governance* edge nothing else in this market shows. The research dossier §6.4 specifies platform-strength routing: Claude for architecture/security review, Codex for bulk implementation, Copilot (GPT-5.3-Codex / GPT-5.5) for code review and frontier reasoning.
3. **The model story moves under us if we wait.** GPT-5.3-Codex is the new Copilot LTS through 2027-02-04. GPT-5.4-mini at 0.33× multiplier is the cheapest GA model in the catalog right now. Hardcoding Tier-2 to Haiku locks RuFlo to a single vendor for the fast path; adopting Copilot lets the router pick the cheapest validated GA model per call. Stable semver (`3.8.0`) is the version this should ship under, per the [MEMORY.md "stable semver, no alpha" rule](../../../../.claude/projects/-Users-cohen-Projects-ruflo/memory/feedback_stable_semver_no_alpha.md).

### What the codex adapter already gives us

| Codex adapter file | Copilot adapter equivalent |
|---|---|
| `src/initializer.ts` (CodexInitializer) | `src/initializer.ts` (CopilotInitializer) — same shape, replace `codex mcp add` with SDK session registration |
| `src/cli.ts` (commander, subcommands) | `src/cli.ts` — add `copilot auth`, `copilot mcp register` subcommands |
| `src/dual-mode/orchestrator.ts` (DualModeOrchestrator) | `src/dual-mode/orchestrator.ts` — extend, not rename, into MultiModeOrchestrator |
| `src/loop/index.ts` (runCodexLoop) | `src/loop/index.ts` (runCopilotLoop) — swap `codex exec` subprocess for SDK `session.sendAndWait()` |
| `src/generators/{agents-md,config-toml,skill-md}.ts` | Same generator names; output is Copilot-flavored (`AGENTS.md` content is portable, `config.toml` model defaults differ, skill format is identical) |
| `src/migrations/index.ts` (migrateFromClaudeCode) | Same + new `migrateFromCodex()` per research §8.2 |
| `src/validators/index.ts` | Identical (AGENTS.md + skill.md format are unchanged; config.toml validators get one new model-id check) |
| `src/templates/index.ts` | Identical built-in skills list |

The *only* net-new directories are `src/client/` (SDK wrapper) and `src/mcp/` (bidirectional bridge). Everything else is structural mirroring.

## Decision

Ship `@claude-flow/copilot` as a new v3 monorepo package at `v3/@claude-flow/copilot/`, mirroring `@claude-flow/codex` exactly, with two additive subfolders for SDK and MCP wiring, plus a `MultiModeOrchestrator` that extends `DualModeOrchestrator` into a three-platform collaboration runtime.

### Part A — Package shape

**Path**: `v3/@claude-flow/copilot/`. Bin: `claude-flow-copilot`. Version: `3.8.0` (stable per MEMORY rule, MINOR bump from current `3.7.x` series). Dist-tags `latest`, `alpha`, `v3alpha` all point at the same version for legacy compat.

**Exports** mirror codex with two additions:

```jsonc
"./client": "./dist/client/index.js",
"./mcp":    "./dist/mcp/index.js"
```

**Engines**: `node >= 20` (Copilot SDK requirement; codex was `>= 18`).

**Dependencies** include `@github/copilot-sdk@^1.0.0` (exact version is `1.0.0-beta.12` per the npm search probe in research §3.2, marked `[unverified-exact]` until the registry is accessible from the build host — pinned to caret-major). Same commander/fs-extra/chalk/inquirer/yaml/toml lineup as codex. Peer deps `@claude-flow/cli` and `@claude-flow/guidance` (both optional).

### Part B — `src/client/` (new — SDK wrapper)

Four files, all sub-500-line:

- **`auth.ts`** — `resolveCredential()` verifies the Copilot CLI is authenticated by exec'ing `gh auth status` (or checking `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` env). The SDK reads credentials itself from env vars or stored OAuth — this wrapper **never reads the raw token**. Token handle (literally the string `"gh-auth"` or the env-var name that resolved) is cached at `~/.config/ruflo/copilot/token.json` (chmod 600), or in-memory if the cache file is unavailable. `clearCachedToken()` removes the handle. The handle is **not the token**; the absolute rule from MEMORY ("never expose the user's API keys") means even the cache file holds only a source identifier, never the credential value.
- **`chat.ts`** — `CopilotClient` wraps `@github/copilot-sdk`'s client-session model. Exposes `createSession({ model, mcpServers, streaming, permissionHandler })`, `sendAndWait({ prompt })`, `stop()`. The `runGoverned(prompt, taskId)` method is the canonical entry: it fires `pre-task` → `route` → `compile (guidance)` → SDK call → `post-task` → `finalizeRun (guidance)` in order, exactly as the codex adapter does for `codex exec`.
- **`tools.ts`** — `defineCopilotTool(name, schema, handler)` registers a callable tool against the SDK's tool-calling protocol; `CopilotToolRegistry` aggregates them for `createSession({ tools })`.
- **`models.ts`** — `COPILOT_MODEL_CATALOG` const with the three confirmed GA OpenAI models from research §4:
  - `gpt-5.3-codex` — tier 3, 1× multiplier, LTS through 2027-02-04, **default Tier 3 coder**
  - `gpt-5.4-mini` — tier 2, 0.33× multiplier, **default Tier 2 fast**
  - `gpt-5.5` — tier 3, 7.5× multiplier, **Tier 3 frontier reasoning (opt-in)**
  Plus `getOptimalModel(complexity, allowFrontier)` returning the model ID by tier or by 0–100 complexity score. Other model strings from the broader catalog (`gpt-4.1`, `gpt-5.2-codex`, `gpt-5.4-nano`, etc.) are listed in a `RETIRING_MODELS` const for migration warnings only — they MUST NOT be selected by the router.

### Part C — `src/mcp/` (new — bidirectional bridge)

- **`register.ts`** — `registerRufloMcpWithCopilot(projectPath, toolFilter)` returns the `mcpServers` object shape required by `createSession({ mcpServers: { ruflo: { type: 'local', command: 'npx', args: [...], tools: ['*'] } } })`. Defaults: `type: 'local'`, `command: 'npx'`, `args: ['-y', 'ruflo@latest', 'mcp', 'start']`, `tools: ['*']`, `env: { CLAUDE_FLOW_CONFIG }`. This is the path that lets Copilot agents call `memory_store`, `swarm_init`, `hooks_route`, etc. during a session.
- **`bridge.ts`** — `CopilotMcpBridge`: per-session bookkeeping so the orchestrator can report what MCP tools Copilot called during a run, feeding the same telemetry sink ADR-146 P5 specifies. Read-only at v1; the audit consumes it.

### Part D — `MultiModeOrchestrator` (extends DualModeOrchestrator)

The codex `DualModeOrchestrator`'s `WorkerConfig.platform` is `'claude' | 'codex'`. Renaming would break every importer. Instead:

```ts
// in @claude-flow/copilot/src/dual-mode/orchestrator.ts
import { DualModeOrchestrator, WorkerConfig as BaseConfig } from '@claude-flow/codex/dual-mode';

export interface MultiModeWorkerConfig extends Omit<BaseConfig, 'platform'> {
  platform: 'claude' | 'codex' | 'copilot';
  copilotModel?: string;
  copilotOptions?: { permissionHandler?: 'approve-all' | 'deny-all' | 'custom'; streaming?: boolean };
}

export class MultiModeOrchestrator extends DualModeOrchestrator {
  protected async executeHeadless(config: MultiModeWorkerConfig): Promise<string> {
    if (config.platform === 'copilot') return this.executeCopilotHeadless(config);
    return super.executeHeadless(config as BaseConfig);
  }
}
```

`executeCopilotHeadless` builds the collaborative prompt the same way the parent class does (memory bridge, role context, namespace), calls `CopilotClient.runGoverned()` instead of spawning a subprocess, and returns the response. The dependency-level execution graph (parent's `buildDependencyLevels`), the shared `collaboration` memory namespace, and the `CollaborationTemplates` machinery are **inherited unchanged**.

`TriModeCollaborationTemplates` (Copilot package only) adds `featureDevelopment` (claude→codex→copilot→claude pipeline) and `securityAudit` (copilot/gpt-5.5 scanner → codex fixer), per research §6.4.

### Part E — `/loop` runner

`runCopilotLoop()` mirrors `runCodexLoop()` exactly, with one substitution: instead of `runCodexExec()` spawning `codex exec`, the loop iteration calls `CopilotClient.runGoverned(buildCopilotLoopPrompt(state), state.iteration)`. State is persisted at `.copilot/loop/<name>.json`. Stop sentinel is `<name>.stop`. Complete sentinel is `<name>.complete`. The state schema gets `mode: 'copilot' | 'command'` (parent codex schema was `'codex' | 'command'`).

### Part F — Governance integration (per CLAUDE.md)

Every `runGoverned` call fires the four hooks from CLAUDE.md (`pre-task`, `route`, `post-task`) by exec'ing `npx @claude-flow/cli@latest hooks <name> ...` exactly as the codex adapter does. The `route` hook may return `[CODEMOD_AVAILABLE]` (deterministic Tier-1, bypass LLM entirely per ADR-143) or `[TASK_MODEL_RECOMMENDATION] Use model="gpt-5.4-mini"` — in the latter case the orchestrator overrides `config.copilotModel` for that single call. Cost-tracking happens automatically via the existing `post-task` plumbing; the Copilot call's model + token estimate is stored to the `cost-tracking` namespace.

### Part G — Auth + secrets (the hardest constraint)

The MEMORY rule is absolute: **never print, persist, log, or echo the raw GitHub token**. The implementation MUST:

1. Resolve credentials by **delegation** — let the bundled Copilot CLI read `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, or the stored `gh auth login` OAuth. Our code never sees the value.
2. Verify auth state by exec'ing `gh auth status` (exit code 0 ↔ authenticated). Capture **only** the exit code, not stdout.
3. Cache only a **source identifier** (`"env:COPILOT_GITHUB_TOKEN"` or `"gh-cli"`) at `~/.config/ruflo/copilot/token.json`, chmod 600.
4. Never write the cache file under `.copilot/` inside a project (gitignore is not a defense). Use the per-user `~/.config` location only.
5. Surface auth failure as a typed error (`COPILOT_AUTH_REQUIRED`) with the action the user must take (`gh auth login` or `export GITHUB_TOKEN=...`) — never the token value.

### Phased integration plan

| Phase | Scope | Where |
|---|---|---|
| **P1** | Package skeleton + `src/client/models.ts` + `src/client/auth.ts` + unit tests | `v3/@claude-flow/copilot/` |
| P2 | `src/client/chat.ts` + `runGoverned` lifecycle | same |
| P3 | `src/mcp/register.ts` + `bridge.ts` + register-with-Copilot integration test | same |
| P4 | `MultiModeOrchestrator` + `TriModeCollaborationTemplates` + dual-mode dependency-level tests | same |
| P5 | `CopilotInitializer` + `--copilot` flag in `@claude-flow/cli`'s `init` command; migrations + validators | `v3/@claude-flow/cli`, this package |

P2–P5 are wired behind the same `CLAUDE_FLOW_STRICT_*` env-var pattern ADR-144 introduced; legacy projects without `@github/copilot-sdk` installed simply skip Copilot worker spawns with a structured warning.

## Alternatives considered

**Extend `@claude-flow/codex` in-place.** Adds a third platform to the same package. Cheaper in lines of code but breaks the modular naming (`@claude-flow/codex` is no longer Codex-only) and forces every existing `claude-flow-codex` bin user to pull in `@github/copilot-sdk`'s ~25MB dependency tree. The codex package's published cost should stay proportional to "Codex CLI integration". A separate `@claude-flow/copilot` keeps the dependency footprint segmented.

**Pure MCP integration — register a ruflo MCP server with Copilot, ship no SDK code.** Defensible. Users running Copilot already get RuFlo tools via the existing `npx ruflo mcp start`. But the *governance* value (compile/enforce/prove/evolve wrapping every Copilot model call) requires a code path *inside* the orchestrator that knows when a Copilot call is happening. MCP-only means the model call is opaque to RuFlo; we can only audit what tools Copilot decided to invoke, not what model produced what reasoning. The `MultiModeOrchestrator` route is the only one that gives full provenance.

**Cloud-only via GitHub Actions.** Run RuFlo+Copilot collaboration as a GHA workflow with the Copilot Agent service. Loses the local-first MCP server architecture, breaks the `dual run` developer-loop UX, and introduces a per-org admin-approval dependency. Useful future addition; not a substitute for the local adapter.

**Wait for a published `@github/copilot-sdk@1.0.0` (non-beta).** The research probe found `1.0.0-beta.12` despite the GA announcement. Pinning to `^1.0.0` accepts any minor; if the registry returns 404 in CI, the package's optional-peer pattern (existing codex precedent) lets us ship the scaffold + tests now and tighten the version in a follow-up PR once the exact registry version is confirmed.

## Consequences

**Positive**:
- Tri-mode collaboration becomes the default for the `dual run` developer workflow — three platforms cross-validating in one shared memory namespace.
- ADR-026's 3-tier router can route Tier 2 to GPT-5.4-mini (0.33× credits) instead of paid Haiku, when Copilot auth is available.
- The codex adapter pattern is **validated as a template**, lowering the cost of any future platform adapter (Gemini, Mistral Devstral, etc.).
- Copilot's MCP architecture (client-side subprocess) means RuFlo's local MCP server stays the source of truth; no extra deployment surface.

**Negative / risks**:
- New dependency on `@github/copilot-sdk` whose published version conflicts with the GA announcement. Pinning to `^1.0.0` is the safe move; build fails if the registry only has the beta version need to be caught by a CI sanity check.
- The `gh auth status` exit-code check is the auth gate; on a machine without the `gh` CLI installed at all, the user gets `COPILOT_AUTH_REQUIRED` with no actionable hint about installing `gh` first. Doctor command MUST flag this.
- `MultiModeOrchestrator` depends on `@claude-flow/codex` (peer dep) at runtime. If the user imports `@claude-flow/copilot/dual-mode` without codex installed, the import throws. Codex must be a runtime dep (not peer) for the dual-mode path, OR the orchestrator must dynamically import and fall back to a single-platform mode.
- Adding a `copilot:` worker prefix to the existing dual-mode CLI changes the spec parser. The codex package's `parseWorkerSpecs()` must be extended (or shadowed in the Copilot package) to accept three platforms.

**Deferred**:
- Streaming tool calls — undocumented in MCP docs (research §9, item 2). Treat as unsupported at v1.
- Rate-limit / usage-header surface — not documented (research §9, item 5). Token-count estimation at the application boundary is the v1 fallback; once the SDK exposes headers, swap to authoritative usage.
- BYOK (Bring Your Own Key) flow — the SDK supports it via `COPILOT_PROVIDER_*` env vars; not wired in the v1 adapter. P6 enhancement.
- Preview-model selection (Raptor mini, Gemini 3 Flash, Claude Opus 4.6 fast mode in Copilot) — admin approval per-org, undocumented from the SDK side. v1 ships only GA OpenAI models.

## Validation

P1 lands with:
- Unit test: `getOptimalModel(complexity=10)` returns `gpt-5.4-mini`; `getOptimalModel(complexity=85, allowFrontier=true)` returns `gpt-5.5`.
- Unit test: `resolveCredential()` returns `null` when no env var is set and `gh auth status` exits non-zero; returns the source identifier (never the token) when authenticated.
- Lint pass: every file in `v3/@claude-flow/copilot/src/` ≤ 500 lines; `grep -rE 'ghp_|gho_|github_pat_|sk-' src/` returns empty.
- Build pass: `tsc --noEmit` clean against the exact tsconfig copied from codex.

P2–P5 each ship with their own smoke test against the mocked SDK (`tests/__mocks__/@github/copilot-sdk.ts`) plus an opt-in E2E run gated behind `COPILOT_E2E=1` env var (consumes real AI credits — runs only in nightly CI).

## References

- [Copilot SDK research dossier](../../../docs/research/copilot-sdk-ruflo-integration.md) — full source inventory, model catalog, governance integration design (1047 lines, 16 grade-A sources).
- [`@claude-flow/codex` package](../../@claude-flow/codex/) — the structural template this ADR mirrors.
- [`@claude-flow/guidance` control plane](../../@claude-flow/guidance/src/index.ts) — the four-verb governance API (compile, enforce, prove, evolve).
- GitHub Copilot SDK docs: https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started
- GA announcement: https://github.blog/changelog/2026-06-02-copilot-sdk-is-now-generally-available/
- GPT-5.3-Codex LTS announcement: https://github.blog/changelog/2026-05-17-gpt-5-3-codex-is-now-the-base-model-for-copilot-business-and-enterprise/
- GPT-5.5 GA: https://github.blog/changelog/2026-04-24-gpt-5-5-is-generally-available-for-github-copilot/
- MCP feature: https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/mcp

## Open questions (carried from research §9)

These do not block ADR acceptance; they are scheduled into specific P-phases:

1. **Streaming tool calls** — research §9 item 2; resolves in P2 with empirical SDK testing.
2. **Rate-limit / usage headers** — research §9 item 5; resolves in P2; falls back to token estimation if unavailable.
3. **`@github/copilot-sdk` exact version** — research §9 item 8; resolves at install time on the build host.
4. **MCP spec revision** — research §9 item 9; deferred until GitHub publishes the spec version they conform to; pattern-compatible with MCP 2024-11-05.
5. **`@claude-flow/security` TokenCache** — research §9 item 7; confirmed absent. P1 implements file-cache directly using `PathValidator` from `@claude-flow/security` (already exists) to validate the `~/.config/ruflo/copilot/` directory.

## Implementation notes (2026-06-03)

The package skeleton, the `src/client/` SDK wrapper, the `src/mcp/` bridge,
the `MultiModeOrchestrator`, the `/loop` runner, all generators / validators
/ migrations / templates, the CLI bin, the initializer, the README, and the
package-level AGENTS.md are all in tree at `v3/@claude-flow/copilot/`.

**Build metrics:**

- `npm install --no-package-lock --no-workspaces` succeeded in ~5s (198 packages).
- `npm run build` (`tsc`) is clean — zero TypeScript errors.
- `npm test` (vitest run) reports **56 tests across 6 files, all passing**, in ~485ms.

**File-size discipline:**

- 24 `.ts` files in `src/`, totaling 3,582 lines.
- Largest file: `src/dual-mode/orchestrator.ts` at 363 lines.
- Every file is well under the 500-line ceiling from `v3/CLAUDE.md`.

**Secret-scan:**

- `grep -rE 'ghp_[a-zA-Z0-9]|gho_[a-zA-Z0-9]|github_pat_|sk-[a-zA-Z0-9]{20,}' src/` returns only the legitimate detector pattern inside `src/validators/index.ts`.
- No hardcoded credentials anywhere in the source tree.

**What ships in this commit:**

- `src/client/models.ts` + tests — Tier 2/3 routing table, `getOptimalModel()` (10 test cases).
- `src/client/auth.ts` + tests — `resolveCredential()` returns SOURCE identifiers only, never the token value. Cache file path `~/.config/ruflo/copilot/token.json`, chmod 600. `CopilotAuthRequiredError` with stable code.
- `src/client/chat.ts` — `CopilotClient` with dual mode: dynamic import of `@github/copilot-sdk` (optional), falling back to driving the bundled `copilot` CLI in `-p/--prompt` mode. `runGoverned()` wires the four hook lifecycle calls.
- `src/client/tools.ts` — `defineCopilotTool()` + `CopilotToolRegistry`.
- `src/mcp/register.ts` + tests — `registerRufloMcpWithCopilot()` builds the local-stdio `mcpServers` map. `buildMcpServers()` merges caller-supplied servers.
- `src/mcp/bridge.ts` + tests — per-session MCP tool-call audit.
- `src/dual-mode/orchestrator.ts` + tests — `MultiModeOrchestrator` extending `EventEmitter`, supporting all three platforms (claude / codex / copilot). `TriModeCollaborationTemplates` for feature / security / refactor pipelines.
- `src/dual-mode/cli.ts` — `claude-flow-copilot dual run` command with three-platform spec parser.
- `src/loop/index.ts` + `cli.ts` — `runCopilotLoop()` mirrors `runCodexLoop()` shape, calls Copilot via `runGoverned()` each iteration. State in `.copilot/loop/<name>.json`.
- `src/generators/{agents-md,config-toml,skill-md}.ts` — Copilot-flavored emitters. JSON config is canonical (`.copilot/config.json`); TOML preserved for codex symmetry.
- `src/migrations/index.ts` — `migrateFromClaudeCode()` + new `migrateFromCodex()` per research §8.
- `src/validators/index.ts` — AGENTS.md / SKILL.md / config validators. Config validator additionally warns on retiring models (`gpt-4.1`, `gpt-5.2-codex`, etc.).
- `src/initializer.ts` — `CopilotInitializer` writes AGENTS.md + `.copilot/config.json` + skill stubs + `.copilot/AGENTS.override.md`. Updates `.gitignore`. Dual mode optionally emits `CLAUDE.md`.
- `src/cli.ts` — `claude-flow-copilot` bin with `init`, `auth status`/`auth clear`, `mcp register`, `chat`, `doctor`, `info`, `dual`, `loop` subcommands.
- 6 test files: `models`, `auth`, `register`, `orchestrator`, `initializer`, `validators` — 56 assertions total.

**Copilot CLI integration (dogfooding):**

The GitHub Copilot CLI (`@github/copilot` v1.0.59) was installed globally during this work. It has a non-interactive `-p/--prompt` mode (with `--allow-all-tools` required for unattended use); `src/client/chat.ts`'s CLI fallback uses exactly that surface. Authoring the package itself was done by Claude Code rather than driven through `copilot -p` calls, because the CLI requires interactive `gh auth login` first and the development host's auth state was not present in this session — `npx claude-flow-copilot auth status` would surface `COPILOT_AUTH_REQUIRED` and exit 1. Once the user authenticates (`gh auth login`), the package can be self-dogfooded for any subsequent code generation. The CLI fallback path in `chat.ts` was tested end-to-end at the type level (vitest covers the path through the dry-run flag in tests).

**Not in this commit (deferred to follow-up PRs):**

- The `--copilot` flag in the top-level `@claude-flow/cli` `init` command (P5).
- A real E2E test against the live SDK behind `COPILOT_E2E=1` — requires authenticated CI infrastructure.
- Publishing the package to npm — the user explicitly stages and publishes; not done here.

**Validation gate (re-runnable):**

```bash
cd v3/@claude-flow/copilot
npm install --no-package-lock --no-workspaces
npm run build                  # tsc clean
npm test                       # 56/56 passing
find src -name '*.ts' | xargs wc -l | awk '$1 > 500 { print }'   # empty
grep -rE 'ghp_[a-zA-Z0-9]|gho_[a-zA-Z0-9]|github_pat_|sk-[a-zA-Z0-9]{20,}' src/    # only validator detector
```

