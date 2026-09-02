#!/usr/bin/env node

/**
 * Safe wrapper for ruv-swarm MCP server
 * Handles known logger issue in v1.0.8
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

console.log('🚀 Starting ruv-swarm MCP server with error handling...');

const ruvSwarmProcess = spawn('npx', ['ruv-swarm', 'mcp', 'start'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    MCP_MODE: 'stdio',
    LOG_LEVEL: 'WARN'
  }
});

// Forward stdin to ruv-swarm
process.stdin.pipe(ruvSwarmProcess.stdin);

// Handle stdout (JSON-RPC messages)
ruvSwarmProcess.stdout.pipe(process.stdout);

// Handle stderr with filtering
const rlErr = createInterface({
  input: ruvSwarmProcess.stderr,
  crlfDelay: Infinity
});

let errorHandled = false;

rlErr.on('line', (line) => {
  // Filter out the known logger error
  if (line.includes('logger.logMemoryUsage is not a function')) {
    if (!errorHandled) {
      console.error('⚠️  Known ruv-swarm v1.0.8 logger issue detected - continuing normally');
      console.error('💡 This error does not affect functionality');
      errorHandled = true;
    }
    return;
  }
  
  // Forward other stderr output
  process.stderr.write(line + '\n');
});

// Handle process exit
ruvSwarmProcess.on('exit', (code, signal) => {
  if (code !== null && code !== 0) {
    console.error(`\n❌ ruv-swarm exited with code ${code}`);
    console.error('💡 Try using: npx claude-flow@alpha mcp start');
  }
  process.exit(code || 0);
});

// Handle errors
ruvSwarmProcess.on('error', (error) => {
  console.error('❌ Failed to start ruv-swarm:', error.message);
  console.error('💡 Try using: npx claude-flow@alpha mcp start');
  process.exit(1);
});

// Handle termination signals
process.on('SIGTERM', () => {
  ruvSwarmProcess.kill('SIGTERM');
});

process.on('SIGINT', () => {
  ruvSwarmProcess.kill('SIGINT');
});