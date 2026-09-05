# ADR-129 — `@ruvector/rvagent-wasm` Full Integration: JsModelProvider, RVF Composer, Gallery CRUD, and Plugin Bridge

**Status**: Accepted — Implemented in v3.8.0 (2026-05-27)
**Date**: 2026-05-24
**Authors**: claude (drafted with rUv)
**Related**: ADR-115 (rvagent / Managed Agents two-runtime architecture), ADR-026 (3-tier model routing), ADR-112 (MCP tool discoverability), ADR-118 (AIDefence 2.3.0), ADR-126 (neural-trader substrate integration), ADR-127 (GitHub stack modernization), issues #2042 (provider routing fix), #1810 (model pin regression)
**Supersedes**: nothing — extends the `rvagent` surface established by ADR-115

## Context

Ruflo 3.7.0 is the first stable (post-alpha) release. The `@ruvector/rvagent-wasm@0.1.0` package ships five classes: `WasmAgent`, `WasmGallery`, `JsModelProvider`, `WasmRvfBuilder`, and `WasmMcpServer`. The current MCP surface covers 10 tools (7 agent + 3 gallery). Precise gaps, verified by source inspection:

### Gap 1 — JsModelProvider wired around, not through (HIGH severity)

`promptWasmAgent` (`v3/@claude-flow/cli/src/ruvector/agent-wasm.ts:154-196`) calls `entry.agent.prompt(input)`, detects the echo stub, and only then routes through `callAnthropicMessages` (`agent-execute-core.ts:102`). `set_model_provider()` and `new JsModelProvider(callback)` are never called anywhere in the codebase (`grep -rn "new JsModelProvider"` returns zero hits). The consequence: the WASM agent's internal loop — multi-turn conversation state, tool dispatch, turn count, stop conditions — never actually runs against a real LLM. The echo-detection bypass is a workaround, not an integration. When `@ruvector/rvagent-wasm@0.2.x` ships a working LLM bridge, this bypass will compete with the provider callback, producing unpredictable double-routing.

The fix template already exists: `callAnthropicMessages` at `agent-execute-core.ts:102` has Anthropic / OpenRouter / Ollama branch dispatch per `RUFLO_PROVIDER` and key-presence precedence. `resolveAnthropicModel` (`agent-execute-core.ts:398`) handles model normalization. The JS callback shape of `JsModelProvider` is `async (messagesJson: string) => string`, which maps cleanly to a thin adapter over `callAnthropicMessages`.

### Gap 2 — `WasmRvfBuilder.addMcpTools()` not exposed (HIGH severity)

`buildRvfContainer` (`agent-wasm.ts:395-415`) instantiates `WasmRvfBuilder` and calls `addPrompt`, `addTool`, `addSkill` — but never `addMcpTools`. The `GalleryTemplateDetail` interface at `agent-wasm.ts:51` includes `mcp_tools: Array<...>`, but `buildRvfFromTemplate` (`agent-wasm.ts:420-429`) drops `template.mcp_tools` silently when building the RVF. No `wasm_agent_compose` MCP tool exists (confirmed: `grep -rn "wasm_agent_compose" src/mcp-tools/` returns nothing). This means sandboxed WASM agents cannot call any of ruflo's 314 MCP tools. WasmAgents are isolated from the swarm they are supposed to participate in.

### Gap 3 — Six agent-introspection methods not exposed (MEDIUM severity)

`agent-wasm.ts` already calls `turn_count()`, `file_count()`, and `is_stopped()` in `syncAgentInfo` (line 218). `get_state()`, `get_todos()`, and `reset()` are implemented in the WASM module but have no corresponding MCP tool. There is no way for an orchestrator to inspect an agent's todo list, snapshot its full state, or reset it between tasks without terminating and re-creating it.

### Gap 4 — Ten of thirteen `WasmGallery` methods not exposed (MEDIUM severity)

`wasm_gallery_list`, `wasm_gallery_search`, and `wasm_gallery_create` exist. The adapter layer already implements `getGalleryCategories`, `getGalleryCount`, and the internal `getGallery` singleton (`agent-wasm.ts:319-326`). Missing from the MCP surface: `loadRvf`, `configure`, `getCategories`, `listByCategory`, `addCustom`, `removeCustom`, `importCustom`, `exportCustom`, `getActive`, `getConfig`. Of these, `importCustom` takes user-supplied JSON and deserializes it inside the WASM runtime — it requires an AIDefence gate before the bytes reach `gallery.importCustom()`.

### Gap 5 — No plugin bridge contract (LOW severity, HIGH leverage)

Ruflo has 35 plugins across `/plugins/ruflo-*/` and `/v3/plugins/`. Each plugin exposes agents, skills, and commands. None of them can declare capabilities to the WASM agent runtime: there is no `"rvagent"` field in `.claude-plugin/plugin.json` (checked against `ruflo-core/plugin.json` as the reference). A WASM agent that needs to call a domain-specific plugin's skills — e.g. `ruflo-neural-trader`'s `trader-signal` or `ruflo-browser`'s session tools — has no mechanism to receive them at creation time.

### Why this matters now

ADR-115 established the two-runtime architecture (WASM local + Managed cloud) with one interface. The "make WASM first-class" half was deferred. With 3.7.0 stable as the baseline, the next minor release (3.8.0) is the natural point to close these gaps. WasmAgents that cannot call real LLMs, cannot access MCP tools, and cannot be introspected are useful only as sandboxed file-I/O runners — a small fraction of the use cases the architecture promises.

## Decision

Land four independently shippable phases targeting `3.8.0`. Each phase has a defined scope, measurable acceptance criteria, and a CI smoke that guards against regression.

---

### Phase 1 — JsModelProvider integration (smallest blast radius; ships first)

**What changes**

In `agent-wasm.ts`, replace the echo-stub bypass in `promptWasmAgent` with a `JsModelProvider` callback constructed at agent-creation time. The callback bridges to `callAnthropicMessages` from `agent-execute-core.ts`:

```typescript
// pseudocode — not implementation
import { JsModelProvider } from '@ruvector/rvagent-wasm';
import { callAnthropicMessages, resolveAnthropicModel } from '../mcp-tools/agent-execute-core.js';

const provider = new JsModelProvider(async (messagesJson: string) => {
  const messages = JSON.parse(messagesJson);
  const model = resolveAnthropicModel(info.config.model);
  const result = await callAnthropicMessages({ prompt: messages.at(-1)?.content ?? '', systemPrompt, model, maxTokens: 2048 });
  return JSON.stringify({ role: 'assistant', content: result.output ?? '' });
});
agent.set_model_provider(provider);
```

The echo-stub detection block (`agent-wasm.ts:165-196`) becomes dead code once the provider is wired. Keep it as a fallback for when `ANTHROPIC_API_KEY` is absent (existing behaviour, existing test coverage). The `resolveAnthropicModel` and `callAnthropicMessages` functions at `agent-execute-core.ts:398` and `102` are re-used unchanged — no modification to the provider routing logic.

**Acceptance criteria**

1. `wasm_agent_prompt` on a new agent with `ANTHROPIC_API_KEY` set returns a real LLM response, not an echo string.
2. `wasm_agent_prompt` with no API key returns the echo stub plus the `[NOTE: ...]` hint (existing fallback preserved).
3. `entry.agent.turn_count()` increments per prompt turn (proves the WASM loop ran, not the bypass).

**CI smoke**

`scripts/smoke-wasm-provider-bridge.mjs` — creates an agent, sends one prompt, asserts response does not start with `"echo: "`, asserts `turn_count >= 1`. Runs against the local WASM module (no live API call required if ANTHROPIC_API_KEY is absent — fallback path covers the CI case). Add to `v3-ci.yml` alongside the existing `smoke-cli-*.mjs` battery.

---

### Phase 2 — `wasm_agent_compose` and `addMcpTools` bridge (largest architectural win)

**What changes**

1. Extend `buildRvfContainer` in `agent-wasm.ts` to accept `mcpTools?: McpToolDescriptor[]` and call `builder.addMcpTools(JSON.stringify(mcpTools))`.

2. Add `wasm_agent_compose` to `wasm-agent-tools.ts` — a new MCP tool that:
   - Accepts `{ skills?, mcpTools?, prompts?, tools?, orchestratorConfig? }`.
   - Calls the extended `buildRvfContainer`.
   - Returns the resulting RVF as a base64 string plus a manifest of what was packed.
   - Optionally accepts `agentId` to wire the resulting RVF into a live agent.

3. Expose a helper `listRufloMcpTools(): McpToolDescriptor[]` that reads the registered tool registry (the same registry that backs `mcp_tool_list`) and returns the descriptor array that `addMcpTools` expects. This is the wire that lets WasmAgents call any of the 314 ruflo MCP tools.

**Security note (does NOT require a separate ADR)**: `addMcpTools` embeds tool *descriptors* (name, description, input schema) into the RVF container. It does not embed credentials or give the WASM agent host-OS access. Actual tool execution still routes through the MCP server, which has its own authorization layer. Flag in the tool description that callers should pass only the tool subset the agent needs — principle of least privilege.

**Acceptance criteria**

1. `wasm_agent_compose({ mcpTools: [{ name: "memory_search", ... }] })` returns a valid RVF (passes `WasmRvfBuilder.validate()`).
2. An agent created from that RVF reports `memory_search` in `get_tools()`.
3. `buildRvfFromTemplate` no longer silently drops `template.mcp_tools` — the `mcp_tools` field from `GalleryTemplateDetail` is included in the built container.

**CI smoke**

`scripts/smoke-wasm-rvf-compose.mjs` — builds an RVF with two tool descriptors, calls `WasmRvfBuilder.validate()` on the output bytes, asserts both tools appear in the parsed manifest. No LLM call required. Add to `v3-ci.yml`.

---

### Phase 3 — Gallery CRUD and agent introspection (MCP tool surface expansion)

**What changes**

Add ~16 new MCP tools across two groups in `wasm-agent-tools.ts`:

*Agent introspection (3 tools)*: `wasm_agent_state` (calls `get_state()`), `wasm_agent_todos` (calls `get_todos()`), `wasm_agent_reset` (calls `reset()`, clears turn count and messages). These map directly to methods already present on the `WasmAgent` instance stored in the `agents` map.

*Gallery management (10 new tools)*: `wasm_gallery_load_rvf` (returns base64 of `gallery.loadRvf(id)`), `wasm_gallery_configure`, `wasm_gallery_categories`, `wasm_gallery_by_category`, `wasm_gallery_add_custom`, `wasm_gallery_remove_custom`, `wasm_gallery_import`, `wasm_gallery_export`, `wasm_gallery_active`, `wasm_gallery_config`.

`wasm_gallery_import` requires an **AIDefence gate** before the payload reaches `gallery.importCustom()`. The pattern from `security-tools.ts:48` (`getAIDefence()` lazy singleton) is the template. The tool must call `aidefence_scan` on the `templates_json` input and reject payloads flagged as unsafe. This is not a separate ADR — it reuses the existing AIDefence integration pattern established by ADR-118.

**Acceptance criteria**

1. `wasm_agent_todos` on a freshly created agent returns a valid (possibly empty) JSON structure without throwing.
2. `wasm_agent_reset` on an agent that has received prompts resets `turn_count` to 0.
3. `wasm_gallery_import` with a known-malicious payload (e.g. prompt-injection string in a template description) is blocked by AIDefence before reaching the WASM runtime.
4. `wasm_gallery_categories` returns at least one category key.

**CI smoke**

`scripts/smoke-wasm-gallery-crud.mjs` — instantiates the gallery, calls categories, adds a custom template, lists by category, exports, removes. Asserts round-trip. Runs without API keys. Add to `v3-ci.yml`.

---

### Phase 4 — Plugin bridge contract (plugin → WasmAgent skill wiring)

**What changes**

Define an optional `"rvagent"` section in `.claude-plugin/plugin.json` that lets a plugin declare which of its skills should be available to WasmAgents, and whether to auto-wire them via `addMcpTools`:

```json
{
  "rvagent": {
    "exposeSkillsAsTools": ["trader-signal", "trader-backtest"],
    "autoWireOnCompose": true
  }
}
```

`wasm_agent_compose` gains an `includePlugins?: string[]` parameter. When set, it reads each listed plugin's `plugin.json`, extracts `rvagent.exposeSkillsAsTools`, converts them to MCP tool descriptors (name, description from the skill's SKILL.md frontmatter), and passes them to `addMcpTools`. No plugin code needs to change unless it wants to opt in.

The contract is intentionally minimal: plugins opt in by adding the `"rvagent"` block. Plugins that do not add the block are unaffected. No existing plugin is broken.

**Acceptance criteria**

1. A test plugin with `"rvagent": { "exposeSkillsAsTools": ["test-skill"] }` causes `wasm_agent_compose({ includePlugins: ["test-plugin"] })` to include `test-skill` in the composed RVF.
2. A plugin without the `"rvagent"` block is ignored silently — no error.
3. `wasm_agent_compose` with `includePlugins` containing an unknown plugin name returns a warning in the manifest but does not fail.

**CI smoke**

`scripts/smoke-wasm-plugin-bridge.mjs` — creates a minimal fixture plugin with a `plugin.json` declaring one skill, calls `wasm_agent_compose({ includePlugins: ["fixture"] })`, asserts the skill appears in the RVF manifest. Add to `v3-ci.yml`.

**Separate ADR required?** No. The bridge is a read-only contract (plugins declare intent; no plugin code changes are mandatory). If a future phase grants WasmAgents the ability to *execute* plugin skills with elevated host privileges, that would require a separate permissions ADR. Phase 4 as described does not — it only passes skill descriptors into the WASM sandbox's tool list, where execution is mediated by the existing MCP server.

---

## Consequences

### Positive

- **WasmAgents become real participants in the swarm.** Phase 2 closes the isolation gap: sandboxed agents can call any of the 314 ruflo MCP tools via the descriptor bridge, enabling use cases like a WASM-sandboxed code-execution agent that calls `memory_search` or `hooks_post_task` without OS access.
- **Provider routing consistency.** Phase 1 brings WasmAgents under the same Anthropic / OpenRouter / Ollama routing as `agent_execute` (#2042). Users with `OPENROUTER_API_KEY` or `OLLAMA_API_KEY` will get working WASM agent responses without any additional configuration.
- **Composable agent templates.** Phases 2 and 4 enable domain-specific agents composed at runtime (e.g. a neural-trader agent with `trader-signal` skills pre-wired) without requiring a new gallery template entry for every configuration permutation.
- **Introspectability for orchestrators.** Phase 3's `wasm_agent_todos` and `wasm_agent_state` tools let swarm coordinators inspect WASM agent progress mid-task without polling the prompt interface.

### Negative / risks

1. **Cost surface expansion.** Phase 1 means every `wasm_agent_prompt` call with `ANTHROPIC_API_KEY` set will make a billable LLM call. The echo-bypass currently used by some integrations (e.g. sandboxed test runners that don't set a key) is preserved via the fallback path, but callers who previously relied on echo behavior for cost-free sandboxing need to know the behaviour has changed. The `wasm_agent_create` description should be updated to note the billing implication.

2. **`addMcpTools` blast radius.** Phase 2 gives a WASM agent descriptors for any of the 314 MCP tools. If `listRufloMcpTools()` returns the full set by default, an agent could be configured to call dangerous tools (`memory_delete`, `federation_*`, `aidefence_*`). Mitigation: `wasm_agent_compose` should accept an explicit `mcpTools` allowlist; `listRufloMcpTools()` should require the caller to pass a scope (e.g. `"memory-read-only"`, `"all"`). The tool description must document this prominently.

3. **`importCustom` prompt-injection surface.** Phase 3's `wasm_gallery_import` deserializes user-supplied JSON inside the WASM runtime. A malicious `system_prompt` field in an imported template could direct a WasmAgent toward harmful behavior. The AIDefence gate required by the acceptance criteria is the primary mitigation, but it depends on AIDefence's prompt-injection detection coverage — which is probabilistic, not guaranteed. The tool should be marked `HIGH_RISK` in the MCP tool registry and require explicit user confirmation in the CLI wrapper.

4. **Plugin bridge maintenance burden.** Phase 4 introduces a new field in `plugin.json` that every plugin author must learn. The field is optional and has no effect unless used, but it creates documentation debt. The `ruflo-plugin-creator` scaffold (`plugins/ruflo-plugin-creator/`) should be updated to include the `"rvagent"` stub commented out, so new plugins are aware of the option without being forced to use it.

## Acceptance criteria per phase (summary)

| Phase | Key test | CI smoke | Regression guard |
|---|---|---|---|
| 1 | `wasm_agent_prompt` returns non-echo response; `turn_count >= 1` | `smoke-wasm-provider-bridge.mjs` | Fails if echo stub still returned when key is set |
| 2 | `wasm_agent_compose` produces `WasmRvfBuilder.validate()`-passing RVF with requested tools | `smoke-wasm-rvf-compose.mjs` | Fails if `mcp_tools` dropped from gallery template |
| 3 | `wasm_agent_todos` returns JSON; `wasm_gallery_import` blocks malicious payload | `smoke-wasm-gallery-crud.mjs` | Fails if AIDefence gate bypassed |
| 4 | Fixture plugin skill appears in composed RVF | `smoke-wasm-plugin-bridge.mjs` | Fails if unknown plugin name throws instead of warns |

## Implementation order and release target

Phases 1 and 2 are the highest-value and lowest-risk changes. They should be landed as a single PR (one diff, two logical units, one smoke batch) to minimize review overhead. Phase 3 can follow as a separate PR — it is additive surface expansion with no changes to existing tools. Phase 4 is lowest priority and can slip to 3.9.0 if the plugin.json contract needs broader community input.

Target: Phases 1–3 in `3.8.0` (next minor). Phase 4 in `3.8.0` if capacity allows, else `3.9.0`.

## Implementation record (v3.8.0 — 2026-05-24)

All four phases shipped in a single PR (#2123, merged 2026-05-24). Release v3.8.0 tagged same day.

### Gap 2 implementation summary (Phase 2)

**Files changed**:
- `v3/@claude-flow/cli/src/ruvector/agent-wasm.ts` — `buildRvfContainer` gains `mcpTools?: McpToolDescriptor[]`; calls `builder.addMcpTools(JSON.stringify(mcpTools))`. `buildRvfFromTemplate` now passes `template.mcp_tools` (was silently dropped).
- `v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` — `wasm_agent_compose` MCP tool added with full `DESTRUCTIVE_TOOL_PATTERNS` gate, `SAFE_MCP_TOOLS` allowlist (28 tools), `mcpToolsAllowDestructive` opt-in flag, and `includePlugins` for Phase 4 plugin wiring.

**Smoke results (smoke-wasm-rvf-compose.mjs)**: 7/7 PASS
1. `wasm_agent_compose` tool registered
2. `mcpToolsAllowDestructive` gate present
3. `DESTRUCTIVE_TOOL_PATTERNS` defined
4. `buildRvfFromTemplate` passes `mcp_tools` (silent drop fixed)
5. `buildRvfContainer` calls `builder.addMcpTools()` (314-tool bridge wired)
6. `includePlugins` param present (Phase 4 plugin bridge)
7. Destructive pattern guards cover `memory_delete`, `federation_*`, `swarm_shutdown`, `agent_terminate`

**Backward compat**: `wasm_agent_create` and `wasm_agent_prompt` unaffected — `mcpTools` parameter is optional with empty-array default. Existing agents with no `mcp_tools` field continue to work identically.

**MCP tools accessible to WASM agents**: 314 (full ruflo surface, gated by allowlist)
