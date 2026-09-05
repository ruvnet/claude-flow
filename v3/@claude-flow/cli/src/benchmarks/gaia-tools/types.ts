/**
 * Shared types for the GAIA agent tool-use subsystem — ADR-133-PR2
 *
 * These types mirror the Anthropic Messages API `tool_use` / `tool_result`
 * content block spec so that `gaia-agent.ts` (PR-3) can call the Anthropic
 * SDK without an extra type-mapping layer.
 *
 * Refs: ADR-133, #2156
 * https://docs.anthropic.com/en/api/messages
 */

// ---------------------------------------------------------------------------
// Tool definition (what we send to Claude in the `tools` array)
// ---------------------------------------------------------------------------

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

// ---------------------------------------------------------------------------
// Tool call produced by Claude (arrives inside a `content` block)
// ---------------------------------------------------------------------------

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool result we send back to Claude in the next `user` turn
// ---------------------------------------------------------------------------

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  /** Optional — set to true when the tool fails so Claude can recover. */
  is_error?: boolean;
}

// ---------------------------------------------------------------------------
// Union of everything that can appear in a Messages API content array
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: 'text';
  text: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

// ---------------------------------------------------------------------------
// Outcome of a single tool invocation inside the agent loop
// ---------------------------------------------------------------------------

export interface ToolCallResult {
  /** The block that triggered this call. */
  toolUse: ToolUseBlock;
  /** String output to return to Claude (or error description). */
  output: string;
  /** True if the tool returned an error output. */
  isError: boolean;
}

// ---------------------------------------------------------------------------
// Tool handler interface — every gaia-tool must implement this
// ---------------------------------------------------------------------------

export interface GaiaTool {
  /** Must match the `name` field in the ToolDefinition. */
  readonly name: string;
  /** The definition object passed to Anthropic in the `tools` array. */
  readonly definition: ToolDefinition;
  /**
   * Execute the tool.  Returns a plain string (success) or throws (will be
   * caught by the agent loop and wrapped in an `is_error: true` result).
   */
  execute(input: Record<string, unknown>): Promise<string>;
}

// ---------------------------------------------------------------------------
// Catalogue — list of all tools registered for a GAIA run
// ---------------------------------------------------------------------------

export type GaiaToolCatalogue = GaiaTool[];
