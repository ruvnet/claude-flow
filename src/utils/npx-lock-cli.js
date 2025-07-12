#!/usr/bin/env node

/**
 * NPX Lock CLI
 * 
 * Command-line utility to manage NPX cache locks
 * Useful for debugging and manual lock management
 */

import { npxCacheManager } from './npx-cache-manager.js';

const command = process.argv[2];

async function main() {
  switch (command) {
    case 'status':
      const status = await npxCacheManager.getLockStatus();
      if (status.locked) {
        console.log('🔒 NPX cache is locked');
        console.log(`   PID: ${status.pid}`);
        console.log(`   Command: ${status.command}`);
        console.log(`   Age: ${Math.round(status.age / 1000)}s`);
        console.log(`   Expired: ${status.expired ? 'Yes' : 'No'}`);
      } else {
        console.log('🔓 NPX cache is not locked');
      }
      break;
      
    case 'release':
      await npxCacheManager.releaseLock(true);
      console.log('✅ NPX cache lock released');
      break;
      
    case 'acquire':
      const acquired = await npxCacheManager.acquireLock();
      if (acquired) {
        console.log('✅ NPX cache lock acquired');
        console.log('Press Ctrl+C to release the lock');
        // Keep the process running
        await new Promise(() => {});
      } else {
        console.log('❌ Failed to acquire NPX cache lock');
      }
      break;
      
    default:
      console.log('NPX Lock CLI - Manage NPX cache locks');
      console.log('\nUsage:');
      console.log('  npx-lock status   - Check lock status');
      console.log('  npx-lock release  - Force release lock');
      console.log('  npx-lock acquire  - Acquire lock (for testing)');
  }
}

main().catch(console.error);