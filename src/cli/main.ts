#!/usr/bin/env node
/**
 * Claude-Flow CLI - Phase 2 Unified Entry Point
 * Deployed unified CLI system eliminating all code duplication
 */

import { configManager } from '../config/config-manager.js';
import { logger } from '../core/logger.js';

// Import the unified CLI system
import { main as unifiedMain } from './unified/cli.js';

// Environment setup
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Main entry point
async function main(): Promise<void> {
  try {
    // Initialize core systems
    await logger.configure({
      level: process.env.CLAUDE_FLOW_LOG_LEVEL || 'info',
      format: 'text',
      destination: 'console',
    });

    // Load configuration
    try {
      await configManager.load('./claude-flow.config.json');
    } catch {
      // Use default config if no file found
      configManager.loadDefault();
    }

    // Execute unified CLI - Phase 2 deployment
    await unifiedMain(process.argv);
    
  } catch (error) {
    console.error('Failed to start Claude-Flow:', error);
    process.exit(1);
  }
}

// Run main if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}