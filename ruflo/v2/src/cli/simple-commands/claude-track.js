#!/usr/bin/env node

/**
 * Claude Token Tracking - Extracts token usage from Claude sessions
 * Works in background without interfering with Claude CLI
 */

import { spawn } from 'child_process';
import { trackTokens } from './token-tracker.js';

/**
 * Parse token information from Claude telemetry output
 */
function parseTokensFromTelemetry(data) {
  try {
    // Look for lines containing token information
    const lines = data.split('\n');
    
    for (const line of lines) {
      if (line.includes('api_request') && line.includes('attributes')) {
        // Try to extract from structured output
        const match = line.match(/input_tokens['":\s]+(\d+).*output_tokens['":\s]+(\d+)/);
        if (match) {
          return {
            inputTokens: parseInt(match[1]),
            outputTokens: parseInt(match[2])
          };
        }
      }
      
      // Also look for simpler patterns
      if (line.includes('input_tokens:') || line.includes('output_tokens:')) {
        const inputMatch = line.match(/input_tokens:\s*'?(\d+)'?/);
        const outputMatch = line.match(/output_tokens:\s*'?(\d+)'?/);
        
        if (inputMatch || outputMatch) {
          return {
            inputTokens: inputMatch ? parseInt(inputMatch[1]) : 0,
            outputTokens: outputMatch ? parseInt(outputMatch[1]) : 0
          };
        }
      }
    }
  } catch (error) {
    // Silently ignore parse errors
  }
  
  return null;
}

/**
 * Background token tracker for Claude sessions
 */
export async function trackClaudeSession() {
  console.log('🔍 Claude token tracker started (running in background)');
  console.log('   Token usage will be saved to .claude-flow/metrics/token-usage.json');
  
  let totalInput = 0;
  let totalOutput = 0;
  let lastUpdate = Date.now();
  
  // Monitor Claude's telemetry output
  process.stdin.on('data', async (data) => {
    const output = data.toString();
    const tokens = parseTokensFromTelemetry(output);
    
    if (tokens && (tokens.inputTokens > 0 || tokens.outputTokens > 0)) {
      totalInput += tokens.inputTokens;
      totalOutput += tokens.outputTokens;
      
      // Track tokens
      await trackTokens({
        sessionId: `claude-session-${Date.now()}`,
        agentType: 'claude-cli',
        command: 'interactive',
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        metadata: {
          source: 'telemetry_stream'
        }
      });
      
      // Show update every 10 seconds max
      if (Date.now() - lastUpdate > 10000) {
        console.log(`📊 Token Update: Input: ${totalInput}, Output: ${totalOutput}`);
        lastUpdate = Date.now();
      }
    }
  });
  
  // Handle shutdown
  process.on('SIGINT', () => {
    console.log(`\n📊 Session Total: Input: ${totalInput}, Output: ${totalOutput}`);
    console.log('✅ Token tracking data saved');
    process.exit(0);
  });
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  trackClaudeSession();
}