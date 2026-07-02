#!/usr/bin/env node
/**
 * RVF WASM Kernel — MCP STDIO Transport
 *
 * Private in-process tunnel for MCP tool calls.
 * Runs inside the chat-ui container as a stdio MCP server,
 * forwarding tool requests to the MCP bridge over the internal
 * Docker network (HTTP). Bypasses HTTPS requirement since
 * stdio transport is trusted (no network exposure).
 *
 * RVF Segments Used:
 *   WASM_SEG (0x10) — Lightweight query microkernel (~5KB control plane)
 *   CRYPTO_SEG (0x0C) — Request signing for bridge authentication
 *   META_IDX_SEG (0x0D) — Tool registry cache
 *
 * Architecture:
 *   ┌──────────────┐  stdio   ┌──────────────┐  HTTP    ┌──────────────┐
 *   │  HF Chat UI  │◄───────►│  RVF Kernel   │────────►│  MCP Bridge  │
 *   │  (SvelteKit) │ trusted │  (this file)  │ private │  (Express)   │
 *   └──────────────┘         └──────────────┘  Docker  └──────────────┘
 */

import { createInterface } from "readline";
import { createHmac, randomUUID } from "crypto";

// ---- RVF Kernel Configuration ----
const BRIDGE_URL = process.env.MCP_BRIDGE_URL || "http://mcp-bridge:3001";
const KERNEL_SECRET = process.env.RVF_KERNEL_SECRET || randomUUID();
const KERNEL_ID = `rvf-kernel-${process.pid}`;
// ADR-166 §7 Q1 (post-ADR-166 residual #3) — the bridge enforces
// `Authorization: Bearer <MCP_AUTH_TOKEN>` on every route when a token is
// configured. The X-RVF-Signature HMAC below is NOT verified by the bridge
// (kept for defense-in-depth / future verification), so the kernel must also
// forward the bearer token or every call 401s against an authenticated bridge.
// Inject MCP_AUTH_TOKEN into the container/process env that runs this kernel.
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";

// ---- META_IDX: Tool Registry Cache ----
let toolCache = null;
let toolCacheTime = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

// ---- CRYPTO_SEG: Request Signing ----
function signRequest(payload) {
  const timestamp = Date.now();
  const nonce = randomUUID();
  const data = `${timestamp}:${nonce}:${JSON.stringify(payload)}`;
  const signature = createHmac("sha256", KERNEL_SECRET).update(data).digest("hex");
  return { timestamp, nonce, signature, kernelId: KERNEL_ID };
}

// ---- WASM_SEG: Core Kernel ----
async function forwardTobridge(method, params) {
  const body = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method,
    ...(params ? { params } : {}),
  };

  const headers = {
    "Content-Type": "application/json",
    "X-RVF-Kernel": KERNEL_ID,
  };

  // Bearer auth — the only credential the bridge actually verifies (ADR-166).
  if (MCP_AUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${MCP_AUTH_TOKEN}`;
  }

  // Sign request if secret is configured
  if (process.env.RVF_KERNEL_SECRET) {
    const sig = signRequest(body);
    headers["X-RVF-Signature"] = sig.signature;
    headers["X-RVF-Timestamp"] = String(sig.timestamp);
    headers["X-RVF-Nonce"] = sig.nonce;
  }

  const resp = await fetch(`${BRIDGE_URL}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  return resp.json();
}

async function handleRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: process.env.BRAND_NAME || "MCP Tools",
            version: "1.0.0",
            description: "RVF WASM Kernel — private stdio tunnel to MCP bridge",
          },
        },
      };

    case "notifications/initialized":
      return { jsonrpc: "2.0", id, result: {} };

    case "tools/list": {
      // Use cached tools if fresh
      if (toolCache && Date.now() - toolCacheTime < CACHE_TTL_MS) {
        return { jsonrpc: "2.0", id, result: { tools: toolCache } };
      }
      // Fetch from bridge
      const resp = await forwardTobridge("tools/list");
      if (resp?.result?.tools) {
        toolCache = resp.result.tools;
        toolCacheTime = Date.now();
      }
      return { jsonrpc: "2.0", id, result: resp?.result || { tools: [] } };
    }

    case "tools/call": {
      const resp = await forwardTobridge("tools/call", params);
      return { jsonrpc: "2.0", id, result: resp?.result, error: resp?.error };
    }

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// ---- STDIO Transport Loop ----
const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const request = JSON.parse(trimmed);
    const response = await handleRequest(request);

    // Only send response if there's an id (not a notification)
    if (request.id !== undefined) {
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  } catch (err) {
    const errorResponse = {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: `Parse error: ${err.message}` },
    };
    process.stdout.write(JSON.stringify(errorResponse) + "\n");
  }
});

rl.on("close", () => process.exit(0));

// Suppress unhandled rejection crashes
process.on("unhandledRejection", (err) => {
  process.stderr.write(`[rvf-kernel] Error: ${err.message}\n`);
});

process.stderr.write(`[rvf-kernel] Started (pid=${process.pid}, bridge=${BRIDGE_URL})\n`);
