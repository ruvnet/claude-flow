#!/usr/bin/env node
/**
 * @claude-flow/cli - MCP Server Entry Point
 *
 * Direct stdio MCP server for Claude Code integration.
 * This entry point handles stdin/stdout directly for MCP protocol
 * without any CLI formatting output that would corrupt the protocol.
 */

import { randomUUID } from 'crypto';

// Console filters — duplicated from bin/cli.js (#2253 / ADR-170 Phase 4).
// TODO(ADR-170 Phase 4): extract this filter block + the JSON-RPC framing
// loop into one shared module imported by both bin/cli.js and this file, so
// the two copies cannot drift again (this file previously lacked the
// stdout→stderr redirect and re-opened the #2253 stdout-corruption bug).
//
// 1. Suppress the SPECIFIC cosmetic "[AgentDB Patch] Controller index not
//    found" noise. Tight match (both prefix AND "Controller index not
//    found") so other [AgentDB Patch] warnings about real issues still flow
//    through.
//
// 2. Redirect noisy stdout writes from upstream embedder libraries
//    (ruvector ONNX loader, ruvector-onnx-embeddings-wasm parallel
//    embedder) to stderr. Those libraries use console.log for progress
//    messages — "Loading model:", "  Downloading: …", "🚀 Initializing N
//    workers" — which corrupts MCP JSON-RPC stdio (#2253). The MCP stdio
//    framer reads stdout only; progress belongs on stderr.
//
// 3. Drop agentdb's misleading "falling back to mock embeddings" cluster —
//    memory-bridge's rescueAgentdbEmbedder swaps to ruvector ONNX in that
//    exact case, so the warnings are stale. See bin/cli.js for details.
const _origWarn = console.warn;
const _origLog = console.log;
const _origError = console.error;
const _isCosmeticAgentdbPatchNoise = (msg) =>
  msg.includes('[AgentDB Patch]') && msg.includes('Controller index not found');
const _STDERR_REDIRECT_PREFIXES = [
  'Loading model: ',
  '  Downloading: ',
  '  Cache hit: ',
  '  Disk cache hit: ',
  'Model cache cleared',
  '🚀 Initializing ',
  '✅ ',
];
const _AGENTDB_MOCK_FALLBACK_DROP_PREFIXES = [
  'Transformers.js initialization failed:',
  '   Falling back to mock embeddings for testing',
  '   This is normal if:',
  '     - Running offline/without internet access',
  '     - Model not yet downloaded',
  '     - Network connectivity issues',
  '   To use real embeddings:',
  '     - Ensure internet connectivity for first',
  '     - Or pre-download: npx agentdb',
];
const _shouldRedirectToStderr = (msg) => {
  for (const prefix of _STDERR_REDIRECT_PREFIXES) {
    if (msg.startsWith(prefix)) return true;
  }
  return false;
};
const _isAgentdbMockFallbackNoise = (msg) => {
  for (const prefix of _AGENTDB_MOCK_FALLBACK_DROP_PREFIXES) {
    if (msg.startsWith(prefix)) return true;
  }
  return false;
};
console.warn = (...args) => {
  const head = String(args[0] ?? '');
  if (_isCosmeticAgentdbPatchNoise(head)) return;
  if (_isAgentdbMockFallbackNoise(head)) return;
  _origWarn.apply(console, args);
};
console.log = (...args) => {
  const head = String(args[0] ?? '');
  if (_isCosmeticAgentdbPatchNoise(head)) return;
  if (_shouldRedirectToStderr(head)) {
    _origError.apply(console, args);
    return;
  }
  _origLog.apply(console, args);
};

// Dynamic import ON PURPOSE (parity with bin/cli.js): a static import is
// hoisted and evaluated before the console filters above are installed, so
// module-load-time progress lines from agentic-flow/ruvector would hit
// stdout unfiltered and corrupt JSON-RPC (#2253).
const { listMCPTools, callMCPTool, hasTool } = await import('../dist/src/mcp-client.js');

const VERSION = '3.0.0';
const sessionId = `mcp-${Date.now()}-${randomUUID().slice(0, 8)}`;

// Log to stderr (doesn't corrupt stdout for MCP protocol)
console.error(
  `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) Starting in stdio mode`
);
console.error(JSON.stringify({
  arch: process.arch,
  mode: 'mcp-stdio',
  nodeVersion: process.version,
  pid: process.pid,
  platform: process.platform,
  protocol: 'stdio',
  sessionId,
  version: VERSION,
}));

// Handle stdin messages
// Audit-flagged DoS protection (audit_1776483149979): cap stdin buffer
// to 10MB. See bin/cli.js for the same protection on the auto-detect path.
const MCP_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;

  if (buffer.length > MCP_MAX_BUFFER_BYTES) {
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: `Buffered stdin exceeds ${MCP_MAX_BUFFER_BYTES} bytes without newline; resetting`,
      },
    }));
    buffer = '';
    return;
  }

  // Process complete JSON messages (newline-delimited)
  let lines = buffer.split('\n');
  buffer = lines.pop() || ''; // Keep incomplete line in buffer

  for (const line of lines) {
    if (line.trim()) {
      try {
        const message = JSON.parse(line);
        const response = await handleMessage(message);
        if (response) {
          console.log(JSON.stringify(response));
        }
      } catch (error) {
        console.error(
          `[${new Date().toISOString()}] ERROR [claude-flow-mcp] Failed to parse:`,
          error instanceof Error ? error.message : String(error)
        );
        // Send parse error response
        console.log(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }));
      }
    }
  }
});

process.stdin.on('end', () => {
  console.error(
    `[${new Date().toISOString()}] INFO [claude-flow-mcp] (${sessionId}) stdin closed, shutting down...`
  );
  process.exit(0);
});

// Handle process termination
process.on('SIGINT', () => {
  console.error(`[${new Date().toISOString()}] INFO [claude-flow-mcp] Received SIGINT`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error(`[${new Date().toISOString()}] INFO [claude-flow-mcp] Received SIGTERM`);
  process.exit(0);
});

/**
 * Handle MCP message
 */
async function handleMessage(message) {
  if (!message.method) {
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32600, message: 'Invalid Request: missing method' },
    };
  }

  const params = message.params || {};

  try {
    switch (message.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'ruflo', version: VERSION },
            capabilities: {
              tools: { listChanged: true },
              resources: { subscribe: true, listChanged: true },
            },
          },
        };

      case 'tools/list': {
        const tools = listMCPTools();
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: tools.map(tool => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          },
        };
      }

      case 'tools/call': {
        const toolName = params.name;
        const toolParams = params.arguments || {};

        if (!hasTool(toolName)) {
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Tool not found: ${toolName}` },
          };
        }

        try {
          const result = await callMCPTool(toolName, toolParams, { sessionId });
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          };
        } catch (error) {
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : 'Tool execution failed',
            },
          };
        }
      }

      case 'notifications/initialized':
        console.error(`[${new Date().toISOString()}] INFO [claude-flow-mcp] Client initialized`);
        return null; // No response for notifications

      case 'ping':
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {},
        };

      default:
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        };
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ERROR [claude-flow-mcp] ${message.method}:`, error);
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error',
      },
    };
  }
}
