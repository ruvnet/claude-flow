/**
 * Auto-update system for @claude-flow packages
 *
 * Features:
 * - Rate-limited update checks (24h default)
 * - Automatic patch updates for security packages
 * - Compatibility validation before updates
 * - Rollback capability
 * - Update history logging
 */

export {
  checkForUpdates,
  checkSinglePackage,
  getInstalledVersion,
  DEFAULT_CONFIG,
} from './checker.js';

export type { UpdateCheckResult, UpdateConfig } from './checker.js';

export {
  shouldCheckForUpdates,
  recordCheck,
  getCachedVersions,
  clearCache,
  loadState,
} from './rate-limiter.js';

export type { RateLimitState } from './rate-limiter.js';

export { validateUpdate, validateBulkUpdate } from './validator.js';

export type { ValidationResult } from './validator.js';

export {
  executeUpdate,
  executeMultipleUpdates,
  rollbackUpdate,
  getUpdateHistory,
  clearHistory,
  loadHistory,
} from './executor.js';

export type { UpdateHistoryEntry, UpdateExecutionResult } from './executor.js';

// Re-export a convenience function for startup
import { checkForUpdates, DEFAULT_CONFIG } from './checker.js';
import type { UpdateCheckResult } from './checker.js';

/**
 * Run update check on startup — NOTIFY-ONLY (ADR-170 Phase 1.1).
 *
 * This function must NEVER install anything. It previously auto-applied
 * patch updates via `execFileSync('npm', ['install', ...])`, a blocking
 * global npm install running inside an unawaited promise that raced the
 * `process.exit(0)` teardown in bin/cli.js — usually killed mid-fetch,
 * occasionally stalling a random command for the length of an npm install.
 *
 * Installs are the exclusive domain of the explicit `update` command
 * (src/commands/update.ts → executeUpdate / executeMultipleUpdates).
 *
 * The `autoUpdate` option is retained for API compatibility but is
 * ignored; `updatesApplied` is always empty.
 */
export async function runStartupUpdateCheck(options: {
  verbose?: boolean;
  /** @deprecated Ignored — the startup path is notify-only (ADR-170). */
  autoUpdate?: boolean;
}): Promise<{
  checked: boolean;
  updatesAvailable: UpdateCheckResult[];
  updatesApplied: string[];
  skippedReason?: string;
}> {
  const result = {
    checked: false,
    updatesAvailable: [] as UpdateCheckResult[],
    updatesApplied: [] as string[],
    skippedReason: undefined as string | undefined,
  };

  try {
    const { results, skipped, reason } = await checkForUpdates(DEFAULT_CONFIG);

    if (skipped) {
      result.skippedReason = reason;
      return result;
    }

    result.checked = true;
    result.updatesAvailable = results;

    // ADR-170 Phase 1.1: notify-only. No install is ever executed here —
    // callers surface `updatesAvailable` and direct users to the explicit
    // `update` command.

    return result;
  } catch {
    // Silently fail on startup - don't block CLI usage
    return result;
  }
}
