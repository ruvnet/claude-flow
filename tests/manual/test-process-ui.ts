#!/usr/bin/env -S deno run --allow-all
/**
 * Manual test script for ProcessUI functionality
 */

import { ProcessManager } from '../../src/cli/commands/start/process-manager.ts';
import { ProcessUI } from '../../src/cli/commands/start/process-ui.ts';
import { colors } from '@cliffy/ansi/colors';

async function testProcessUI() {
  console.log(colors.cyan.bold('Testing ProcessUI...'));
  console.log(colors.gray('─'.repeat(60)));
  console.log('This will launch the interactive UI for 10 seconds');
  console.log('Try pressing: r (refresh), h (help), a (start all), z (stop all)');
  console.log(colors.gray('─'.repeat(60)));
  console.log();
  
  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 2000));

  const manager = new ProcessManager();
  await manager.initialize();
  
  const ui = new ProcessUI(manager);
  
  // Start UI with a timeout
  const timeout = setTimeout(async () => {
    console.log('\n\nTimeout reached, stopping UI...');
    await ui.stop();
    Deno.exit(0);
  }, 10000);

  try {
    await ui.start();
  } catch (error) {
    clearTimeout(timeout);
    console.error('Error:', error);
  }
}

// Run the test
if (import.meta.main) {
  await testProcessUI();
}
