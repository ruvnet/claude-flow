#!/usr/bin/env node
/**
 * @claude-flow/cli - MCP Server Entry Point
 *
 * Direct stdio MCP server for Claude Code integration.
 * This entry point handles stdin/stdout directly for MCP protocol
 * without any CLI formatting output that would corrupt the protocol.
 */

import { randomUUID } from 'crypto';
import { listMCPTools, callMCPTool, hasTool } from '../dist/src/mcp-client.js';

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
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;

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
            serverInfo: { name: 'claude-flow', version: VERSION },
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
