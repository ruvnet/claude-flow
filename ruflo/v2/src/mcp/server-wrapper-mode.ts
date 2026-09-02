#!/usr/bin/env node
/**
 * Claude-Flow MCP Server - Wrapper Mode
 *
 * This version uses the Claude Code MCP wrapper approach instead of templates.
 */

import { ClaudeCodeMCPWrapper } from './claude-code-wrapper.js';

// Check if running as wrapper mode
const isWrapperMode =
  process.env.CLAUDE_FLOW_WRAPPER_MODE === 'true' || process.argv.includes('--wrapper');

async function main() {
  if (isWrapperMode) {
    console.error('Starting Claude-Flow MCP in wrapper mode...');
    const wrapper = new ClaudeCodeMCPWrapper();
    await wrapper.run();
  } else {
    // Fall back to original server
    console.error('Starting Claude-Flow MCP in direct mode...');
    const { runMCPServer } = await import('./server.js');
    await runMCPServer();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
