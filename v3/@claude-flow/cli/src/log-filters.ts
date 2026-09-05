/**
 * Console filter installed at the top of every entry point. Three jobs:
 *
 * 1. Suppress the cosmetic "[AgentDB Patch] Controller index not found"
 *    warning emitted by agentic-flow's runtime patch (it expects agentdb
 *    v1.x layout but we use v3). Tight match: requires BOTH the prefix
 *    AND the specific message. Other [AgentDB Patch] messages flow through.
 *    Audit log audit_1776483149979 flagged the previous broad filter as
 *    too aggressive — this one is tight enough to be safe.
 *
 * 2. (#2253, #2256) Redirect noisy stdout writes from upstream embedder
 *    libraries (ruvector ONNX loader, ruvector-onnx-embeddings-wasm
 *    parallel embedder) to stderr. The libraries use `console.log` for
 *    progress messages like "Loading model:" and "  Downloading: ...",
 *    which corrupts MCP JSON-RPC stdio (#2253) and is generally noise on
 *    stdout.
 *
 * 3. Suppress agentdb's mock-embedder-fallback warning cluster emitted by
 *    `agentdb/dist/controllers/EmbeddingService.js` lines 48–56 when
 *    transformers.js initialisation fails (commonly: macOS arm64 without
 *    `brew install vips` — sharp can't load `libvips-cpp.42.dylib`). The
 *    warnings advertise that agentdb is "falling back to mock embeddings"
 *    — but `memory-bridge.ts::rescueAgentdbEmbedder` monkey-patches
 *    agentdb's embedder to delegate to our working ruvector ONNX pipeline
 *    in that exact case, so the user is NOT actually on mock embeddings.
 *    Letting the warning through is misleading and gets reported as a
 *    bug (user-reported 2026-06-02, no GH issue). Suppression is safe
 *    because the rescue handles the underlying condition; if the rescue
 *    itself fails, the user still sees `[WARN] No results found` from
 *    the calling command which surfaces the real symptom.
 *
 * This file MUST be imported as the first side-effect import in any entry
 * point so the patch is in place before agentic-flow / ruvector / agentdb
 * (and anything that transitively imports them) loads. ES module imports
 * are evaluated before the file's own top-level code, so putting this in
 * src/index.ts directly would race with transitive eager imports.
 */

const isCosmeticAgentdbPatchNoise = (msg: unknown): boolean => {
  const s = String(msg ?? '');
  return s.includes('[AgentDB Patch]') && s.includes('Controller index not found');
};

// #2253 / #2256: prefixes from third-party embedder libs that come out on
// stdout via console.log and corrupt MCP JSON-RPC. We redirect to stderr.
// Match is anchored to known prefixes only — anything else (e.g. legitimate
// user-facing CLI output) is unaffected.
const STDERR_REDIRECT_PREFIXES = [
  'Loading model: ',                // ruvector + ruvector-onnx-embeddings-wasm loader.js
  '  Downloading: ',                // ruvector + ruvector-onnx-embeddings-wasm loader.js
  '  Cache hit: ',                  // ruvector + ruvector-onnx-embeddings-wasm loader.js
  'Model cache cleared',            // ruvector + ruvector-onnx-embeddings-wasm loader.js
  '🚀 Initializing ',               // ruvector-onnx-embeddings-wasm parallel-embedder.mjs
  '✅ ',                            // ruvector-onnx-embeddings-wasm parallel-embedder.mjs (workers ready)
  '  Disk cache hit: ',             // ruvector-onnx-embeddings-wasm parallel-embedder.mjs
];

// (3) Suppress the agentdb mock-embedder-fallback cluster. Each entry below
// matches the EXACT prefix `console.warn` argument from
// agentdb/dist/controllers/EmbeddingService.js:48–56. Keep this list
// pinned to upstream lines, not broadened heuristically — broader filters
// risk hiding real signals (audit_1776483149979 lesson).
const AGENTDB_MOCK_FALLBACK_DROP_PREFIXES = [
  'Transformers.js initialization failed:',        // line 48 — multi-line because the error has multi-line .message
  '   Falling back to mock embeddings for testing', // line 49
  '   This is normal if:',                          // line 50
  '     - Running offline/without internet access', // line 51
  '     - Model not yet downloaded',                // line 52
  '     - Network connectivity issues',             // line 53
  '   To use real embeddings:',                     // line 54
  '     - Ensure internet connectivity for first',  // line 55
  '     - Or pre-download: npx agentdb',            // line 56
];

const shouldRedirectToStderr = (msg: unknown): boolean => {
  const s = String(msg ?? '');
  for (const prefix of STDERR_REDIRECT_PREFIXES) {
    if (s.startsWith(prefix)) return true;
  }
  return false;
};

const isAgentdbMockFallbackNoise = (msg: unknown): boolean => {
  const s = String(msg ?? '');
  for (const prefix of AGENTDB_MOCK_FALLBACK_DROP_PREFIXES) {
    if (s.startsWith(prefix)) return true;
  }
  return false;
};

const origWarn = console.warn.bind(console);
const origLog = console.log.bind(console);
const origError = console.error.bind(console);

console.warn = (...args: unknown[]) => {
  if (isCosmeticAgentdbPatchNoise(args[0])) return;
  if (isAgentdbMockFallbackNoise(args[0])) return;
  origWarn(...args);
};
console.log = (...args: unknown[]) => {
  if (isCosmeticAgentdbPatchNoise(args[0])) return;
  if (shouldRedirectToStderr(args[0])) {
    origError(...args);
    return;
  }
  origLog(...args);
};
