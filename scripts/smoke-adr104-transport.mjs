#!/usr/bin/env node
/**
 * Regression guard for #2618.
 *
 * ADR-104 external verification must import the federation plugin's loader,
 * not the unexported `agentic-flow/transport/loader` subpath.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const sourcePath = resolve(root, 'v3/@claude-flow/plugin-agent-federation/src/transport/midstream-aware-loader.ts');
const distPath = resolve(root, 'v3/@claude-flow/plugin-agent-federation/dist/transport/midstream-aware-loader.js');

if (!existsSync(sourcePath)) {
  console.error(`smoke-adr104-transport: missing source loader: ${sourcePath}`);
  process.exit(1);
}

const source = readFileSync(sourcePath, 'utf8');
if (!source.includes('class WebSocketFallbackTransport')) {
  console.error('smoke-adr104-transport: plugin-owned WebSocket fallback is missing');
  process.exit(1);
}
if (!source.includes("source: 'websocket-fallback'")) {
  console.error('smoke-adr104-transport: loader does not expose websocket-fallback source');
  process.exit(1);
}

if (!existsSync(distPath)) {
  console.log('smoke-adr104-transport: source fallback OK; dist loader not present in this source checkout');
  console.log('Build before external ADR-104 transport verification to test the published import path.');
  process.exit(0);
}

const mod = await import(distPath);
if (typeof mod.loadFederationTransport !== 'function') {
  console.error('smoke-adr104-transport: dist loader does not export loadFederationTransport()');
  process.exit(1);
}

console.log('smoke-adr104-transport: plugin loader import path OK');
