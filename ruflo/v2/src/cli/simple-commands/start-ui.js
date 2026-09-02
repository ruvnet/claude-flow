// start-ui.js - Standalone UI launcher (Web UI by default)
import { printSuccess, printError, printWarning, printInfo } from '../utils.js';
import { compat } from '../runtime-detector.js';

export async function launchUI(args = []) {
  try {
    // Parse arguments
    const portValue = getArgValue(args, '--port') || getArgValue(args, '-p');
    const port = portValue ? parseInt(portValue) : 3000;

    const terminal = args.includes('--terminal') || args.includes('-t');
    const web = !terminal; // Default to web UI unless terminal is specified

    if (web) {
      // Launch Web UI
      try {
        const { ClaudeCodeWebServer } = await import('./web-server.js');
        const webServer = new ClaudeCodeWebServer(port);
        await webServer.start();

        printSuccess('🌐 Claude Flow Web UI is running!');
        console.log(`📍 Open your browser to: http://localhost:${port}/console`);
        console.log();
        console.log('Features:');
        console.log('  ✨ Access all 71+ MCP tools through the web interface');
        console.log('  📊 Real-time monitoring and analytics');
        console.log('  🧠 Neural network training and management');
        console.log('  🔄 Workflow automation and SPARC modes');
        console.log('  🐙 GitHub integration and DAA management');
        console.log();
        console.log('Press Ctrl+C to stop the server');

        // Open browser if possible
        try {
          const openCommand =
            process.platform === 'darwin'
              ? 'open'
              : process.platform === 'win32'
                ? 'start'
                : 'xdg-open';

          const { exec } = await import('child_process');
          exec(`${openCommand} http://localhost:${port}/console`);
        } catch {
          // Browser opening failed, that's okay
        }

        // Handle shutdown
        const shutdown = async () => {
          console.log('\n' + '⏹️  Shutting down Web UI...');
          await webServer.stop();
          printSuccess('✓ Shutdown complete');
          process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        // Keep process alive
        await new Promise(() => {});
      } catch (err) {
        printError(`Failed to launch Web UI: ${err.message}`);
        console.error('Stack trace:', err.stack);
        console.log();
        printWarning('Falling back to terminal UI...');
        // Fall back to terminal UI
        await launchTerminalUI(port);
      }
    }

    if (terminal) {
      await launchTerminalUI(port);
    }
  } catch (err) {
    printError(`Failed to launch UI: ${err.message}`);
    console.error('Stack trace:', err.stack);
  }
}

async function launchTerminalUI(port) {
  // Launch Terminal UI
  try {
    // Try enhanced UI first
    const { launchEnhancedUI } = await import('./process-ui-enhanced.js');
    await launchEnhancedUI();
  } catch (err) {
    // Try simple UI as fallback
    try {
      let ProcessManager, ProcessUI;
      try {
        // Try the compiled version first (for production/npm packages)
        const pmModule = await import('../../../dist/cli/commands/start/process-manager.js');
        const puiModule = await import('../../../dist/cli/commands/start/process-ui-simple.js');
        ProcessManager = pmModule.ProcessManager;
        ProcessUI = puiModule.ProcessUI;
      } catch (distError) {
        // If dist version not found, try TypeScript version (for development)
        const pmModule = await import('../commands/start/process-manager.ts');
        const puiModule = await import('../commands/start/process-ui-simple.ts');
        ProcessManager = pmModule.ProcessManager;
        ProcessUI = puiModule.ProcessUI;
      }

      printSuccess('🚀 Claude-Flow Process Management UI');
      console.log('─'.repeat(60));

      // Initialize process manager
      const processManager = new ProcessManager();
      await processManager.initialize();

      // Start the UI
      const ui = new ProcessUI(processManager);
      await ui.start();

      // Cleanup on exit
      await processManager.stopAll();
      console.log();
      printSuccess('✓ Shutdown complete');
    } catch (fallbackErr) {
      printError(`Failed to launch Terminal UI: ${fallbackErr.message}`);
      console.error('Stack trace:', fallbackErr.stack);

      // Final fallback
      console.log();
      printWarning('UI launch failed. Use these commands instead:');
      console.log();
      console.log('Process Management Commands:');
      console.log('  • Start all: claude-flow start');
      console.log('  • Check status: claude-flow status');
      console.log('  • View logs: claude-flow logs');
      console.log('  • Stop: claude-flow stop');
    }
  }
}

function getArgValue(args, flag) {
  const index = args.indexOf(flag);
  if (index !== -1 && index < args.length - 1) {
    return args[index + 1];
  }
  return null;
}

// Run if called directly
if (import.meta.main) {
  await launchUI();
}
