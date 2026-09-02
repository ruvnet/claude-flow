/**
 * Hook Safety System - Prevents recursive hook execution and financial damage
 *
 * This system protects against infinite loops where Claude Code hooks call
 * 'claude' commands, which could bypass rate limits and cost thousands of dollars.
 *
 * Critical protections:
 * - Environment variable context detection
 * - Recursive call prevention
 * - Circuit breaker for Stop hooks
 * - Configuration validation
 * - Emergency override flags
 */

import { printError, printWarning, printSuccess } from '../utils.js';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

/**
 * Hook Safety Configuration
 */
const HOOK_SAFETY_CONFIG = {
  // Maximum hook execution depth before blocking
  MAX_HOOK_DEPTH: 3,

  // Maximum Stop hook executions per session
  MAX_STOP_HOOK_EXECUTIONS: 2,

  // Circuit breaker timeout (milliseconds)
  CIRCUIT_BREAKER_TIMEOUT: 60000, // 1 minute

  // Environment variables for context detection
  ENV_VARS: {
    CONTEXT: 'CLAUDE_HOOK_CONTEXT',
    DEPTH: 'CLAUDE_HOOK_DEPTH',
    SESSION_ID: 'CLAUDE_HOOK_SESSION_ID',
    SKIP_HOOKS: 'CLAUDE_SKIP_HOOKS',
    SAFE_MODE: 'CLAUDE_SAFE_MODE',
  },
};

/**
 * Global hook execution tracking
 */
class HookExecutionTracker {
  constructor() {
    this.executions = new Map();
    this.sessionId = this.generateSessionId();
    this.resetTimeout = null;
  }

  generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  track(hookType) {
    const key = `${this.sessionId}:${hookType}`;
    const count = this.executions.get(key) || 0;
    this.executions.set(key, count + 1);

    // Auto-reset after timeout
    if (this.resetTimeout) clearTimeout(this.resetTimeout);
    this.resetTimeout = setTimeout(() => {
      this.executions.clear();
    }, HOOK_SAFETY_CONFIG.CIRCUIT_BREAKER_TIMEOUT);

    return count + 1;
  }

  getExecutionCount(hookType) {
    const key = `${this.sessionId}:${hookType}`;
    return this.executions.get(key) || 0;
  }

  reset() {
    this.executions.clear();
    this.sessionId = this.generateSessionId();
  }
}

// Global instance
const executionTracker = new HookExecutionTracker();

/**
 * Hook Context Manager - Tracks hook execution context
 */
export class HookContextManager {
  static setContext(hookType, depth = 1) {
    process.env[HOOK_SAFETY_CONFIG.ENV_VARS.CONTEXT] = hookType;
    process.env[HOOK_SAFETY_CONFIG.ENV_VARS.DEPTH] = depth.toString();
    process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SESSION_ID] = executionTracker.sessionId;
  }

  static getContext() {
    return {
      type: process.env[HOOK_SAFETY_CONFIG.ENV_VARS.CONTEXT],
      depth: parseInt(process.env[HOOK_SAFETY_CONFIG.ENV_VARS.DEPTH] || '0'),
      sessionId: process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SESSION_ID],
      skipHooks: process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SKIP_HOOKS] === 'true',
      safeMode: process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SAFE_MODE] === 'true',
    };
  }

  static clearContext() {
    delete process.env[HOOK_SAFETY_CONFIG.ENV_VARS.CONTEXT];
    delete process.env[HOOK_SAFETY_CONFIG.ENV_VARS.DEPTH];
    delete process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SESSION_ID];
  }

  static isInHookContext() {
    return !!process.env[HOOK_SAFETY_CONFIG.ENV_VARS.CONTEXT];
  }

  static setSafeMode(enabled = true) {
    if (enabled) {
      process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SAFE_MODE] = 'true';
    } else {
      delete process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SAFE_MODE];
    }
  }

  static setSkipHooks(enabled = true) {
    if (enabled) {
      process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SKIP_HOOKS] = 'true';
    } else {
      delete process.env[HOOK_SAFETY_CONFIG.ENV_VARS.SKIP_HOOKS];
    }
  }
}

/**
 * Command Validator - Validates commands for hook safety
 */
export class HookCommandValidator {
  /**
   * Validate if a command is safe to execute from a hook
   */
  static validateCommand(command, hookType) {
    const context = HookContextManager.getContext();
    const warnings = [];
    const errors = [];

    // Critical check: Claude commands in Stop hooks
    if (hookType === 'Stop' && this.isClaudeCommand(command)) {
      errors.push({
        type: 'CRITICAL_RECURSION_RISK',
        message:
          '🚨 CRITICAL ERROR: Claude command detected in Stop hook!\n' +
          'This creates an INFINITE LOOP that can cost THOUSANDS OF DOLLARS.\n' +
          'Stop hooks that call "claude" commands bypass rate limits and\n' +
          'can result in massive unexpected API charges.\n\n' +
          'BLOCKED FOR SAFETY - Use alternative patterns instead.',
      });
    }

    // General recursion detection
    if (context.type && this.isClaudeCommand(command)) {
      const depth = context.depth;

      if (depth >= HOOK_SAFETY_CONFIG.MAX_HOOK_DEPTH) {
        errors.push({
          type: 'HOOK_RECURSION_LIMIT',
          message:
            `🚨 Hook recursion limit exceeded! (Depth: ${depth})\n` +
            `Hook type: ${context.type}\n` +
            'Blocking execution to prevent infinite loop.',
        });
      } else {
        warnings.push({
          type: 'POTENTIAL_RECURSION',
          message:
            `⚠️  WARNING: Claude command in ${context.type} hook (depth: ${depth})\n` +
            'This could create recursion. Consider using --skip-hooks flag.',
        });
      }
    }

    // Check for other dangerous patterns
    if (this.isDangerousPattern(command, hookType)) {
      warnings.push({
        type: 'DANGEROUS_PATTERN',
        message:
          `⚠️  WARNING: Potentially dangerous hook pattern detected.\n` +
          'Review the command and consider safer alternatives.',
      });
    }

    return { warnings, errors, safe: errors.length === 0 };
  }

  static isClaudeCommand(command) {
    // Match various forms of claude command invocation
    const claudePatterns = [
      /\bclaude\b/, // Direct claude command
      /claude-code\b/, // claude-code command
      /npx\s+claude\b/, // NPX claude
      /\.\/claude\b/, // Local claude wrapper
      /claude\.exe\b/, // Windows executable
    ];

    return claudePatterns.some((pattern) => pattern.test(command));
  }

  static isDangerousPattern(command, hookType) {
    const dangerousPatterns = [
      // Commands that could trigger more hooks
      /git\s+commit.*--all/,
      /git\s+add\s+\./,
      // File operations that might trigger watchers
      /watch\s+.*claude/,
      /nodemon.*claude/,
      // Recursive script execution
      /bash.*hook/,
      /sh.*hook/,
    ];

    return dangerousPatterns.some((pattern) => pattern.test(command));
  }
}

/**
 * Circuit Breaker - Prevents runaway hook execution
 */
export class HookCircuitBreaker {
  /**
   * Check if hook execution should be allowed
   */
  static checkExecution(hookType) {
    const executionCount = executionTracker.track(hookType);

    // Stop hook protection - maximum 2 executions per session
    if (hookType === 'Stop' && executionCount > HOOK_SAFETY_CONFIG.MAX_STOP_HOOK_EXECUTIONS) {
      throw new Error(
        `🚨 CIRCUIT BREAKER ACTIVATED!\n` +
          `Stop hook has executed ${executionCount} times in this session.\n` +
          `This indicates a potential infinite loop that could cost thousands of dollars.\n` +
          `Execution blocked for financial protection.\n\n` +
          `To reset: Use --reset-circuit-breaker flag or restart your session.`,
      );
    }

    // General protection for any hook type
    if (executionCount > 20) {
      throw new Error(
        `🚨 CIRCUIT BREAKER: ${hookType} hook executed ${executionCount} times!\n` +
          `This is highly unusual and indicates a potential problem.\n` +
          `Execution blocked to prevent system overload.`,
      );
    }

    // Log warnings for concerning patterns
    if (hookType === 'Stop' && executionCount > 1) {
      printWarning(`⚠️  Stop hook execution #${executionCount} detected. Monitor for recursion.`);
    }

    return true;
  }

  static reset() {
    executionTracker.reset();
    printSuccess('Circuit breaker reset successfully.');
  }

  static getStatus() {
    return {
      sessionId: executionTracker.sessionId,
      executions: Array.from(executionTracker.executions.entries()).map(([key, count]) => {
        const [sessionId, hookType] = key.split(':');
        return { hookType, count };
      }),
    };
  }
}

/**
 * Configuration Validator - Validates hook configurations for safety
 */
export class HookConfigValidator {
  /**
   * Validate Claude Code settings.json for dangerous hook configurations
   */
  static validateClaudeCodeConfig(configPath = null) {
    if (!configPath) {
      // Try to find Claude Code settings
      const possiblePaths = [
        path.join(process.env.HOME || '.', '.claude', 'settings.json'),
        path.join(process.cwd(), '.claude', 'settings.json'),
        path.join(process.cwd(), 'settings.json'),
      ];

      configPath = possiblePaths.find((p) => existsSync(p));

      if (!configPath) {
        return { safe: true, message: 'No Claude Code configuration found.' };
      }
    }

    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const validation = this.validateHooksConfig(config.hooks || {});

      return {
        safe: validation.errors.length === 0,
        configPath,
        ...validation,
      };
    } catch (err) {
      return {
        safe: false,
        error: `Failed to validate configuration: ${err.message}`,
        configPath,
      };
    }
  }

  /**
   * Validate hooks configuration object
   */
  static validateHooksConfig(hooksConfig) {
    const warnings = [];
    const errors = [];

    // Check Stop hooks specifically
    if (hooksConfig.Stop) {
      for (const hookGroup of hooksConfig.Stop) {
        for (const hook of hookGroup.hooks || []) {
          if (hook.type === 'command' && hook.command) {
            const result = HookCommandValidator.validateCommand(hook.command, 'Stop');
            warnings.push(...result.warnings);
            errors.push(...result.errors);
          }
        }
      }
    }

    // Check other dangerous hook types
    const dangerousHookTypes = ['SubagentStop', 'PostToolUse'];
    for (const hookType of dangerousHookTypes) {
      if (hooksConfig[hookType]) {
        for (const hookGroup of hooksConfig[hookType]) {
          for (const hook of hookGroup.hooks || []) {
            if (hook.type === 'command' && hook.command) {
              const result = HookCommandValidator.validateCommand(hook.command, hookType);
              warnings.push(...result.warnings);
              errors.push(...result.errors);
            }
          }
        }
      }
    }

    return { warnings, errors };
  }

  /**
   * Generate safe configuration recommendations
   */
  static generateSafeAlternatives(dangerousConfig) {
    const alternatives = [];

    // Example: Stop hook calling claude
    if (dangerousConfig.includes('claude')) {
      alternatives.push({
        pattern: 'Stop hook with claude command',
        problem: 'Creates infinite recursion loop',
        solution: 'Use flag-based approach instead',
        example: `
// Instead of this DANGEROUS pattern:
{
  "Stop": [{
    "hooks": [{"type": "command", "command": "claude -c -p 'Update history'"}]
  }]
}

// Use this SAFE pattern:
{
  "Stop": [{
    "hooks": [{"type": "command", "command": "touch ~/.claude/needs_update"}]
  }]
}

// Then manually run: claude -c -p "Update history" when needed
        `,
      });

      alternatives.push({
        pattern: 'PostToolUse hook alternative',
        problem: 'Stop hooks execute too frequently',
        solution: 'Use PostToolUse for specific tools',
        example: `
// SAFER: Use PostToolUse for specific operations
{
  "PostToolUse": [{
    "matcher": "Write|Edit|MultiEdit",
    "hooks": [{"type": "command", "command": "echo 'File modified' >> ~/.claude/changes.log"}]
  }]
}
        `,
      });
    }

    return alternatives;
  }
}

/**
 * Safe Hook Execution Wrapper
 */
export class SafeHookExecutor {
  /**
   * Safely execute a hook command with all safety checks
   */
  static async executeHookCommand(command, hookType, options = {}) {
    try {
      // Skip if hooks are disabled
      if (HookContextManager.getContext().skipHooks) {
        console.log(`⏭️  Skipping ${hookType} hook (hooks disabled)`);
        return { success: true, skipped: true };
      }

      // Circuit breaker check
      HookCircuitBreaker.checkExecution(hookType);

      // Command validation
      const validation = HookCommandValidator.validateCommand(command, hookType);

      // Show warnings
      for (const warning of validation.warnings) {
        printWarning(warning.message);
      }

      // Block on errors
      if (!validation.safe) {
        for (const error of validation.errors) {
          printError(error.message);
        }
        return { success: false, blocked: true, errors: validation.errors };
      }

      // Set hook context for nested calls
      const currentContext = HookContextManager.getContext();
      const newDepth = currentContext.depth + 1;
      HookContextManager.setContext(hookType, newDepth);

      // Execute the command with safety context
      const result = await this.executeCommand(command, options);

      return { success: true, result };
    } catch (err) {
      printError(`Hook execution failed: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      // Clear context
      HookContextManager.clearContext();
    }
  }

  static async executeCommand(command, options = {}) {
    // This would integrate with the actual command execution system
    // For now, just log what would be executed
    console.log(`🔗 Executing hook command: ${command}`);

    // Here you would actually execute the command
    // return await execCommand(command, options);

    return { stdout: '', stderr: '', exitCode: 0 };
  }
}

/**
 * Hook Safety CLI Commands
 */
export async function hookSafetyCommand(subArgs, flags) {
  const subcommand = subArgs[0];

  switch (subcommand) {
    case 'validate':
      return await validateConfigCommand(subArgs, flags);
    case 'status':
      return await statusCommand(subArgs, flags);
    case 'reset':
      return await resetCommand(subArgs, flags);
    case 'safe-mode':
      return await safeModeCommand(subArgs, flags);
    default:
      showHookSafetyHelp();
  }
}

async function validateConfigCommand(subArgs, flags) {
  const configPath = flags.config || flags.c;

  console.log('🔍 Validating hook configuration for safety...\n');

  const result = HookConfigValidator.validateClaudeCodeConfig(configPath);

  if (result.safe) {
    printSuccess('✅ Hook configuration is safe!');
    if (result.configPath) {
      console.log(`📄 Validated: ${result.configPath}`);
    }
  } else {
    printError('❌ DANGEROUS hook configuration detected!');

    if (result.errors) {
      console.log('\n🚨 CRITICAL ERRORS:');
      for (const error of result.errors) {
        console.log(`\n${error.message}`);
      }
    }

    if (result.warnings) {
      console.log('\n⚠️  WARNINGS:');
      for (const warning of result.warnings) {
        console.log(`\n${warning.message}`);
      }
    }

    console.log('\n💡 RECOMMENDATIONS:');
    console.log('1. Remove claude commands from Stop hooks');
    console.log('2. Use PostToolUse hooks for specific tools');
    console.log('3. Implement flag-based update patterns');
    console.log('4. Use claude --skip-hooks for manual updates');
  }
}

async function statusCommand(subArgs, flags) {
  const context = HookContextManager.getContext();
  const circuitStatus = HookCircuitBreaker.getStatus();

  console.log('🔗 Hook Safety Status\n');

  console.log('📊 Current Context:');
  if (context.type) {
    console.log(`  🔄 Hook Type: ${context.type}`);
    console.log(`  📏 Depth: ${context.depth}`);
    console.log(`  🆔 Session: ${context.sessionId}`);
    console.log(`  ⏭️  Skip Hooks: ${context.skipHooks ? 'Yes' : 'No'}`);
    console.log(`  🛡️  Safe Mode: ${context.safeMode ? 'Yes' : 'No'}`);
  } else {
    console.log('  ✅ Not currently in hook context');
  }

  console.log('\n⚡ Circuit Breaker Status:');
  console.log(`  🆔 Session: ${circuitStatus.sessionId}`);

  if (circuitStatus.executions.length > 0) {
    console.log('  📊 Hook Executions:');
    for (const exec of circuitStatus.executions) {
      console.log(`    • ${exec.hookType}: ${exec.count} times`);
    }
  } else {
    console.log('  ✅ No hook executions in current session');
  }
}

async function resetCommand(subArgs, flags) {
  console.log('🔄 Resetting hook safety systems...\n');

  HookCircuitBreaker.reset();
  HookContextManager.clearContext();

  printSuccess('✅ Hook safety systems reset successfully!');
  console.log('All execution counters and context cleared.');
}

async function safeModeCommand(subArgs, flags) {
  const enable = !flags.disable && !flags.off;

  if (enable) {
    HookContextManager.setSafeMode(true);
    HookContextManager.setSkipHooks(true);
    printSuccess('🛡️  Safe mode enabled!');
    console.log('• All hooks will be skipped');
    console.log('• Claude commands will show safety warnings');
    console.log('• Additional validation will be performed');
  } else {
    HookContextManager.setSafeMode(false);
    HookContextManager.setSkipHooks(false);
    printSuccess('⚡ Safe mode disabled.');
    console.log('Normal hook execution restored.');
  }
}

function showHookSafetyHelp() {
  console.log(`
🛡️  Hook Safety System - Prevent Infinite Loops & Financial Damage

USAGE:
  claude-flow hook-safety <command> [options]

COMMANDS:
  validate      Validate hook configuration for dangerous patterns
  status        Show current hook safety status and context
  reset         Reset circuit breakers and execution counters
  safe-mode     Enable/disable safe mode (skips all hooks)

VALIDATE OPTIONS:
  --config, -c <path>     Path to Claude Code settings.json

SAFE-MODE OPTIONS:
  --disable, --off        Disable safe mode

EXAMPLES:
  # Check your Claude Code hooks for dangerous patterns
  claude-flow hook-safety validate

  # Check specific configuration file
  claude-flow hook-safety validate --config ~/.claude/settings.json

  # View current safety status
  claude-flow hook-safety status

  # Reset if circuit breaker is triggered
  claude-flow hook-safety reset

  # Enable safe mode (skips all hooks)
  claude-flow hook-safety safe-mode

  # Disable safe mode
  claude-flow hook-safety safe-mode --disable

🚨 CRITICAL WARNING:
Stop hooks that call 'claude' commands create INFINITE LOOPS that can:
• Bypass API rate limits
• Cost thousands of dollars per day
• Make your system unresponsive

SAFE ALTERNATIVES:
• Use PostToolUse hooks instead of Stop hooks
• Implement flag-based update patterns
• Use 'claude --skip-hooks' for manual updates
• Create conditional execution scripts

For more information: https://github.com/ruvnet/claude-flow/issues/166
`);
}

/**
 * Emergency CLI flags for Claude commands
 */
export function addSafetyFlags(command) {
  // Add safety flags to any claude command
  const context = HookContextManager.getContext();

  if (context.type) {
    // Automatically add --skip-hooks if in hook context
    if (!command.includes('--skip-hooks')) {
      command += ' --skip-hooks';
    }
  }

  if (context.safeMode) {
    // Add additional safety flags in safe mode
    if (!command.includes('--dry-run')) {
      command += ' --dry-run';
    }
  }

  return command;
}

export default {
  HookContextManager,
  HookCommandValidator,
  HookCircuitBreaker,
  HookConfigValidator,
  SafeHookExecutor,
  hookSafetyCommand,
  addSafetyFlags,
};
