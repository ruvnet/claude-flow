/**
 * Session Start Hook Integration
 *
 * Auto-starts workers when Claude Code session begins.
 */

import { WorkerManager, createWorkerManager } from './index.js';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface SessionHookConfig {
  projectRoot?: string;
  autoStart?: boolean;
  runInitialScan?: boolean;
  workers?: string[];
}

export interface SessionHookResult {
  success: boolean;
  manager: WorkerManager;
  initialResults?: Record<string, unknown>;
  error?: string;
}

// ============================================================================
// Session Hook Functions
// ============================================================================

/**
 * Initialize workers on session start
 *
 * Call this from your SessionStart hook to auto-start the worker system.
 */
export async function onSessionStart(config: SessionHookConfig = {}): Promise<SessionHookResult> {
  const {
    projectRoot = process.cwd(),
    autoStart = true,
    runInitialScan = true,
    workers = ['health', 'security', 'git'],
  } = config;

  try {
    // Create and initialize manager
    const manager = createWorkerManager(projectRoot);
    await manager.initialize();

    let initialResults: Record<string, unknown> | undefined;

    // Run initial scan of critical workers
    if (runInitialScan && workers.length > 0) {
      initialResults = {};

      for (const workerName of workers) {
        try {
          const result = await manager.runWorker(workerName);
          initialResults[workerName] = {
            success: result.success,
            data: result.data,
            alerts: result.alerts,
          };
        } catch {
          initialResults[workerName] = { success: false, error: 'Worker failed' };
        }
      }
    }

    // Start scheduled workers
    if (autoStart) {
      await manager.start({
        autoSave: true,
        statuslineUpdate: true,
      });
    }

    return {
      success: true,
      manager,
      initialResults,
    };
  } catch (error) {
    return {
      success: false,
      manager: createWorkerManager(projectRoot),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Clean up workers on session end
 */
export async function onSessionEnd(manager: WorkerManager): Promise<void> {
  await manager.stop();
}

/**
 * Generate session start output for Claude Code hooks
 *
 * Returns formatted output suitable for Claude Code SessionStart hook.
 */
export function formatSessionStartOutput(result: SessionHookResult): string {
  const lines: string[] = [];

  if (result.success) {
    lines.push('[Workers] System initialized');

    if (result.initialResults) {
      const healthResult = result.initialResults.health as { data?: { status?: string } } | undefined;
      const securityResult = result.initialResults.security as { data?: { status?: string; totalIssues?: number } } | undefined;
      const gitResult = result.initialResults.git as { data?: { branch?: string; uncommitted?: number } } | undefined;

      if (healthResult?.data) {
        const status = healthResult.data.status || 'unknown';
        const icon = status === 'healthy' ? '✓' : status === 'warning' ? '⚠' : '✗';
        lines.push(`  ${icon} Health: ${status}`);
      }

      if (securityResult?.data) {
        const status = securityResult.data.status || 'unknown';
        const issues = securityResult.data.totalIssues || 0;
        const icon = status === 'clean' ? '✓' : status === 'warning' ? '⚠' : '✗';
        lines.push(`  ${icon} Security: ${status} (${issues} issues)`);
      }

      if (gitResult?.data) {
        const branch = gitResult.data.branch || 'unknown';
        const uncommitted = gitResult.data.uncommitted || 0;
        lines.push(`  ├─ Branch: ${branch}`);
        lines.push(`  └─ Uncommitted: ${uncommitted}`);
      }
    }

    lines.push('[Workers] Background scheduling started');
  } else {
    lines.push(`[Workers] Failed to initialize: ${result.error}`);
  }

  return lines.join('\n');
}

// ============================================================================
// Shell Script Generator
// ============================================================================

/**
 * Generate a shell hook script for integration with .claude/settings.json
 */
export function generateShellHook(projectRoot: string): string {
  const hookPath = path.join(projectRoot, 'v3', '@claude-flow', 'hooks');

  return `#!/bin/bash
# Claude Flow V3 Workers - Session Start Hook
# Auto-generated - do not edit manually

set -euo pipefail

PROJECT_ROOT="${projectRoot}"
HOOKS_PATH="${hookPath}"

# Run worker initialization via Node.js
node --experimental-specifier-resolution=node -e "
const { onSessionStart, formatSessionStartOutput } = require('\${HOOKS_PATH}/dist/workers/session-hook.js');

async function main() {
  const result = await onSessionStart({
    projectRoot: '\${PROJECT_ROOT}',
    autoStart: true,
    runInitialScan: true,
    workers: ['health', 'security', 'git'],
  });

  console.log(formatSessionStartOutput(result));
}

main().catch(err => {
  console.error('[Workers] Error:', err.message);
  process.exit(1);
});
"
`;
}

// ============================================================================
// Integration Helper
// ============================================================================

/**
 * Create a global worker manager instance for the session
 */
let globalManager: WorkerManager | null = null;

export function getGlobalManager(): WorkerManager | null {
  return globalManager;
}

export function setGlobalManager(manager: WorkerManager): void {
  globalManager = manager;
}

export async function initializeGlobalManager(projectRoot?: string): Promise<WorkerManager> {
  if (globalManager) {
    return globalManager;
  }

  const result = await onSessionStart({
    projectRoot,
    autoStart: true,
    runInitialScan: true,
  });

  if (!result.success) {
    throw new Error(result.error || 'Failed to initialize worker manager');
  }

  globalManager = result.manager;
  return globalManager;
}
