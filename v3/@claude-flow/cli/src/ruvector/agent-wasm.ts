/**
 * RuVector Agent WASM Integration
 *
 * Wraps @ruvector/rvagent-wasm for sandboxed AI agent execution.
 * Provides WasmAgent lifecycle, gallery templates, RVF container building,
 * and MCP server bridge — all running in WASM without OS access.
 *
 * Published API (v0.1.0): WasmAgent, WasmGallery, WasmMcpServer,
 * WasmRvfBuilder, JsModelProvider, initSync.
 *
 * @module @claude-flow/cli/ruvector/agent-wasm
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// ── Types ────────────────────────────────────────────────────

export interface WasmAgentConfig {
  model?: string;
  instructions?: string;
  maxTurns?: number;
}

export interface WasmAgentInfo {
  id: string;
  state: 'idle' | 'running' | 'error';
  config: WasmAgentConfig;
  model: string;
  turnCount: number;
  fileCount: number;
  isStopped: boolean;
  createdAt: string;
}

export interface GalleryTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  version: string;
  author: string;
  builtin: boolean;
}

export interface GalleryTemplateDetail extends GalleryTemplate {
  tools: Array<{ name: string; description: string; parameters: unknown[]; returns: string }>;
  prompts: Array<{ name: string; system_prompt: string; version: string }>;
  skills: Array<{ name: string; description: string; trigger: string; content: string }>;
  mcp_tools: Array<{ name: string; description: string; input_schema: unknown; group: string }>;
  capabilities: Array<{ name: string; rights: string[]; scope: string; delegation_depth: number }>;
}

export interface ToolResult {
  success: boolean;
  output: string;
}

// ── WASM Module Detection & Init ─────────────────────────────

let _wasmReady = false;

/**
 * Check if @ruvector/rvagent-wasm is installed and loadable.
 */
export async function isAgentWasmAvailable(): Promise<boolean> {
  try {
    const mod = await import('@ruvector/rvagent-wasm');
    return typeof mod.WasmAgent === 'function';
  } catch {
    return false;
  }
}

/**
 * Initialize the WASM module for Node.js. Safe to call multiple times.
 * Uses initSync with file-loaded WASM bytes (browser fetch doesn't work in Node).
 */
export async function initAgentWasm(): Promise<void> {
  if (_wasmReady) return;
  try {
    const mod = await import('@ruvector/rvagent-wasm');
    // In Node.js, load WASM bytes from disk and use initSync
    const require_ = createRequire(import.meta.url);
    const wasmPath = require_.resolve('@ruvector/rvagent-wasm/rvagent_wasm_bg.wasm');
    const wasmBytes = readFileSync(wasmPath);
    mod.initSync(wasmBytes);
    _wasmReady = true;
  } catch (err) {
    throw new Error(`Failed to initialize @ruvector/rvagent-wasm: ${err}`);
  }
}

// ── Agent Registry ───────────────────────────────────────────

const agents = new Map<string, { agent: any; info: WasmAgentInfo }>();
let nextId = 1;

function generateId(): string {
  return `wasm-agent-${nextId++}-${Date.now().toString(36)}`;
}

// ── Agent Lifecycle ──────────────────────────────────────────

/**
 * Create a new sandboxed WASM agent.
 */
export async function createWasmAgent(config: WasmAgentConfig = {}): Promise<WasmAgentInfo> {
  await initAgentWasm();
  const mod = await import('@ruvector/rvagent-wasm');

  // #1810 — was hardcoded `anthropic:claude-sonnet-4-20250514`. Updated to
  // current Sonnet (4.6) so new gallery agents don't silently inherit a
  // year-old model. Callers can still override via `config.model`.
  const configJson = JSON.stringify({
    model: config.model ?? 'anthropic:claude-sonnet-4-6',
    instructions: config.instructions ?? 'You are a helpful coding assistant.',
    max_turns: config.maxTurns ?? 50,
  });

  const agent = new mod.WasmAgent(configJson);

  // ADR-129 P1 — wire JsModelProvider so the WASM runtime routes prompts
  // through the v3 provider system instead of returning the echo stub.
  // attachJsModelProvider is a no-op when no provider keys are set.
  await attachJsModelProvider(agent, config);

  const id = generateId();

  const info: WasmAgentInfo = {
    id,
    state: 'idle',
    config,
    model: agent.model(),
    turnCount: agent.turn_count(),
    fileCount: agent.file_count(),
    isStopped: agent.is_stopped(),
    createdAt: new Date().toISOString(),
  };

  agents.set(id, { agent, info });
  return info;
}

/**
 * Wire a JsModelProvider to a freshly created WasmAgent so its internal
 * conversation loop dispatches through the v3 provider system (ADR-129 P1).
 *
 * The callback bridges the JsModelProvider JSON contract to
 * callAnthropicMessages, which already handles Anthropic / OpenRouter /
 * Ollama routing via RUFLO_PROVIDER + key-presence precedence (#2042).
 *
 * Called once at agent-creation time; the provider stays attached for the
 * agent's lifetime.  No-op (returns false) when no provider keys are
 * configured so the echo-fallback path below is preserved for keyless
 * environments.
 */
async function attachJsModelProvider(agent: any, config: WasmAgentConfig): Promise<boolean> {
  const hasAny = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OLLAMA_API_KEY);
  if (!hasAny) return false;
  const mod = await import('@ruvector/rvagent-wasm');
  const { callAnthropicMessages, resolveAnthropicModel } = await import('../mcp-tools/agent-execute-core.js');
  const model = resolveAnthropicModel(config.model);
  const systemPrompt = config.instructions || 'You are a helpful coding assistant running in a Ruflo WASM agent sandbox.';

  const provider = new mod.JsModelProvider(async (messagesJson: string) => {
    const messages: Array<{ role: string; content: string }> = JSON.parse(messagesJson);
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const prompt = lastUser?.content ?? messagesJson;
    const result = await callAnthropicMessages({ prompt, systemPrompt, model, maxTokens: 2048 });
    if (!result.success) throw new Error(result.error ?? 'provider call failed');
    return JSON.stringify({ role: 'assistant', content: result.output ?? '' });
  });
  agent.set_model_provider(provider);
  return true;
}

/**
 * Send a prompt to a WASM agent.
 *
 * ADR-129 P1: JsModelProvider is now wired at creation time so the WASM
 * agent's internal conversation loop (multi-turn state, turn_count,
 * stop conditions) runs against a real LLM.  The echo-stub detection
 * block is kept as a fallback for keyless environments (CI, sandboxed
 * test runners) — behaviour is identical to the pre-P1 path when no
 * provider key is set.
 *
 * Billing note: every wasm_agent_prompt call with a provider key
 * configured makes a billable LLM call.  Use a keyless environment to
 * get the echo stub for cost-free sandboxing.
 */
export async function promptWasmAgent(agentId: string, input: string): Promise<string> {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);

  entry.info.state = 'running';
  try {
    const wasmResult = await entry.agent.prompt(input);
    entry.info.state = 'idle';
    syncAgentInfo(entry);

    // Detect the WASM echo stub (present when no JsModelProvider was
    // attached, i.e. keyless environments).
    const isEchoStub = typeof wasmResult === 'string' &&
      (wasmResult === `echo: ${input}` || /^echo: /.test(wasmResult.slice(0, 12)));

    if (!isEchoStub) {
      // JsModelProvider routed through the v3 provider system — return
      // the real response.  turn_count was already incremented by the
      // WASM runtime.
      return wasmResult;
    }

    // Echo stub path (keyless fallback — preserved from pre-P1 behaviour).
    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.OLLAMA_API_KEY) {
      return `${wasmResult}\n[NOTE: bundled WASM agent has no LLM; set ANTHROPIC_API_KEY (or OPENROUTER_API_KEY / OLLAMA_API_KEY) to enable real responses via the v3 provider system]`;
    }

    // Key present but provider was not attached at creation time (e.g.
    // agent created before a key was set in the environment).  Fall
    // through to a direct callAnthropicMessages call as a best-effort
    // recovery.
    const { callAnthropicMessages, resolveAnthropicModel } = await import('../mcp-tools/agent-execute-core.js');
    const model = resolveAnthropicModel(entry.info.config.model);
    const systemPrompt = entry.info.config.instructions || 'You are a helpful coding assistant running in a Ruflo WASM agent sandbox.';
    const result = await callAnthropicMessages({ prompt: input, systemPrompt, model, maxTokens: 2048 });
    if (!result.success) {
      return `${wasmResult}\n[NOTE: bundled WASM agent has no LLM; provider fallback failed: ${result.error}]`;
    }
    return result.output ?? '';
  } catch (err) {
    entry.info.state = 'error';
    throw err;
  }
}

/**
 * Execute a tool directly on a WASM agent's sandbox.
 * Tool format: {tool: 'write_file', path: '...', content: '...'} (flat, snake_case).
 * Available tools: read_file, write_file, edit_file, write_todos, list_files.
 */
const VALID_WASM_TOOLS = ['read_file', 'write_file', 'edit_file', 'write_todos', 'list_files'];

export async function executeWasmTool(agentId: string, toolCall: Record<string, unknown>): Promise<ToolResult> {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);
  // Validate tool name to prevent WASM panics on unknown tools
  const toolName = toolCall.tool as string;
  if (toolName && !VALID_WASM_TOOLS.includes(toolName)) {
    return { success: false, output: `Unknown tool: ${toolName}. Available: ${VALID_WASM_TOOLS.join(', ')}` };
  }
  const result = await entry.agent.execute_tool(JSON.stringify(toolCall));
  syncAgentInfo(entry);
  return result as ToolResult;
}

function syncAgentInfo(entry: { agent: any; info: WasmAgentInfo }): void {
  try {
    entry.info.turnCount = entry.agent.turn_count();
    entry.info.fileCount = entry.agent.file_count();
    entry.info.isStopped = entry.agent.is_stopped();
  } catch { /* best-effort */ }
}

/**
 * Get agent info.
 */
export function getWasmAgent(agentId: string): WasmAgentInfo | null {
  const entry = agents.get(agentId);
  if (!entry) return null;
  syncAgentInfo(entry);
  return entry.info;
}

/**
 * List all active WASM agents.
 */
export function listWasmAgents(): WasmAgentInfo[] {
  return Array.from(agents.values()).map(e => {
    syncAgentInfo(e);
    return e.info;
  });
}

/**
 * Terminate a WASM agent and free resources.
 */
export function terminateWasmAgent(agentId: string): boolean {
  const entry = agents.get(agentId);
  if (!entry) return false;
  try { entry.agent.free(); } catch { /* already freed */ }
  agents.delete(agentId);
  return true;
}

/**
 * Get agent state (messages, turn count, etc.)
 */
export function getWasmAgentState(agentId: string): unknown {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);
  return entry.agent.get_state();
}

/**
 * Get agent tools list.
 */
export function getWasmAgentTools(agentId: string): string[] {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);
  return entry.agent.get_tools();
}

/**
 * Get agent todos.
 */
export function getWasmAgentTodos(agentId: string): unknown[] {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);
  return entry.agent.get_todos();
}

/**
 * Export the full agent state as JSON (for persistence).
 */
export function exportWasmState(agentId: string): string {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);
  return JSON.stringify({
    agentState: entry.agent.get_state(),
    tools: entry.agent.get_tools(),
    todos: entry.agent.get_todos(),
    info: entry.info,
  });
}

// ── MCP Server Bridge ────────────────────────────────────────

/**
 * Create a WASM-based MCP server for an agent.
 * Returns a handler function for JSON-RPC requests.
 *
 * Note: WasmMcpServer may have stability issues in v0.1.0 for
 * certain agent configurations. Use with a fully configured agent.
 */
export async function createWasmMcpServer(agentId: string): Promise<(jsonRpc: string) => Promise<string>> {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);

  const mod = await import('@ruvector/rvagent-wasm');
  const server = new mod.WasmMcpServer(entry.agent);

  return (jsonRpc: string) => server.handle_request(jsonRpc);
}

// ── Gallery Templates ────────────────────────────────────────

let _gallery: any | null = null;

async function getGallery(): Promise<any> {
  if (_gallery) return _gallery;
  await initAgentWasm();
  const mod = await import('@ruvector/rvagent-wasm');
  _gallery = new mod.WasmGallery();
  return _gallery;
}

/**
 * List all available gallery templates.
 * Returns objects directly (Gallery.list() returns parsed objects in v0.1.0).
 */
export async function listGalleryTemplates(): Promise<GalleryTemplate[]> {
  const gallery = await getGallery();
  return gallery.list();
}

/**
 * Get gallery template count.
 */
export async function getGalleryCount(): Promise<number> {
  const gallery = await getGallery();
  return gallery.count();
}

/**
 * Get gallery categories with counts.
 */
export async function getGalleryCategories(): Promise<Record<string, number>> {
  const gallery = await getGallery();
  return gallery.getCategories();
}

/**
 * Search gallery templates by query. Returns results with relevance scores.
 */
export async function searchGalleryTemplates(query: string): Promise<Array<GalleryTemplate & { relevance: number }>> {
  const gallery = await getGallery();
  return gallery.search(query);
}

/**
 * Get a gallery template by id.
 * Wraps in try/catch because WasmGallery.get() panics on unknown IDs in v0.1.0.
 */
export async function getGalleryTemplate(id: string): Promise<GalleryTemplateDetail | null> {
  const gallery = await getGallery();
  try {
    return gallery.get(id) ?? null;
  } catch {
    return null;
  }
}

/**
 * Create an agent from a gallery template.
 */
export async function createAgentFromTemplate(templateId: string): Promise<WasmAgentInfo> {
  const template = await getGalleryTemplate(templateId);
  if (!template) throw new Error(`Gallery template not found: ${templateId}`);

  const systemPrompt = template.prompts?.[0]?.system_prompt;
  return createWasmAgent({
    instructions: systemPrompt ?? `You are a ${template.name}.`,
    model: undefined, // Use default
  });
}

// ── RVF Container Operations ─────────────────────────────────

export interface McpToolDescriptor {
  name: string;
  description: string;
  input_schema: unknown;
  group?: string;
}

/**
 * Build an RVF container with prompts, tools, skills, and MCP tool descriptors.
 * Uses the high-level RVF builder API (addPrompt, addTool, addSkill, addMcpTools).
 *
 * ADR-129 P2: mcpTools parameter wires builder.addMcpTools() so that
 * composed agents can declare which of ruflo's 314 MCP tools they need.
 */
export async function buildRvfContainer(opts: {
  prompts?: Array<{ name: string; system_prompt: string; version: string }>;
  tools?: Array<{ name: string; description: string; parameters: unknown[]; returns: string }>;
  skills?: Array<{ name: string; description: string; trigger: string; content: string }>;
  mcpTools?: McpToolDescriptor[];
}): Promise<Uint8Array> {
  await initAgentWasm();
  const mod = await import('@ruvector/rvagent-wasm');
  const builder = new mod.WasmRvfBuilder();

  for (const p of opts.prompts ?? []) {
    builder.addPrompt(JSON.stringify(p));
  }
  for (const t of opts.tools ?? []) {
    builder.addTool(JSON.stringify(t));
  }
  for (const s of opts.skills ?? []) {
    builder.addSkill(JSON.stringify(s));
  }
  // ADR-129 P2: pass MCP tool descriptors into the RVF container so
  // composed agents know which tools are available via the MCP server.
  if (opts.mcpTools && opts.mcpTools.length > 0) {
    builder.addMcpTools(JSON.stringify(opts.mcpTools));
  }

  return builder.build();
}

// ── ADR-129 P3 — Additional gallery methods ──────────────────────────────────

/** Load a template as raw RVF bytes. */
export async function galleryLoadRvf(id: string): Promise<Uint8Array> {
  const gallery = await getGallery();
  return gallery.loadRvf(id);
}

/** Apply configuration overrides to the active template. */
export async function galleryConfigure(configJson: string): Promise<void> {
  const gallery = await getGallery();
  gallery.configure(configJson);
}

/** List templates filtered by category. */
export async function galleryListByCategory(category: string): Promise<GalleryTemplate[]> {
  const gallery = await getGallery();
  return gallery.listByCategory(category);
}

/** Add a custom template to the gallery. */
export async function galleryAddCustom(templateJson: string): Promise<void> {
  const gallery = await getGallery();
  gallery.addCustom(templateJson);
}

/** Remove a custom template by ID. */
export async function galleryRemoveCustom(id: string): Promise<void> {
  const gallery = await getGallery();
  gallery.removeCustom(id);
}

/** Import custom templates from JSON. Returns the count imported. */
export async function galleryImportCustom(templatesJson: string): Promise<number> {
  const gallery = await getGallery();
  return gallery.importCustom(templatesJson);
}

/** Export all custom templates as JSON. */
export async function galleryExportCustom(): Promise<unknown> {
  const gallery = await getGallery();
  return gallery.exportCustom();
}

/** Get the currently active template ID. */
export async function galleryGetActive(): Promise<string | undefined> {
  const gallery = await getGallery();
  return gallery.getActive();
}

/** Get configuration overrides for the active template. */
export async function galleryGetConfig(): Promise<unknown> {
  const gallery = await getGallery();
  return gallery.getConfig();
}

/** Reset a WASM agent — clears messages and turn count. */
export function resetWasmAgent(agentId: string): boolean {
  const entry = agents.get(agentId);
  if (!entry) return false;
  try {
    entry.agent.reset();
    syncAgentInfo(entry);
  } catch { /* best-effort */ }
  return true;
}

/**
 * Build an RVF container from a gallery template.
 *
 * ADR-129 P2: template.mcp_tools is now passed to buildRvfContainer so it
 * is included via builder.addMcpTools().  Previously these descriptors were
 * silently dropped, leaving gallery-template agents unable to declare their
 * intended MCP tool access.
 */
export async function buildRvfFromTemplate(templateId: string): Promise<Uint8Array> {
  const template = await getGalleryTemplate(templateId);
  if (!template) throw new Error(`Gallery template not found: ${templateId}`);

  return buildRvfContainer({
    prompts: template.prompts,
    tools: template.tools,
    skills: template.skills,
    mcpTools: template.mcp_tools,  // ADR-129 P2: was silently dropped
  });
}
