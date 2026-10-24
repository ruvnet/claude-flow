/**
 * GitHub CLI Safety Wrapper - Production-Ready Implementation
 * 
 * Comprehensive wrapper around GitHub CLI commands with:
 * - Injection attack prevention
 * - Timeout handling with graceful cleanup
 * - Process management and recovery
 * - Input validation and sanitization
 * - Rate limiting protection
 * - Comprehensive error handling
 * - Retry logic with exponential backoff
 * - Secure temp file handling
 * - Logging and monitoring
 * 
 * @version 2.0.0
 * @license MIT
 */

import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { randomBytes, createHash } from 'crypto';
import { spawn, execSync } from 'child_process';
import { performance } from 'perf_hooks';

/**
 * Configuration constants
 */
const CONFIG = {
  DEFAULT_TIMEOUT: 30000,          // 30 seconds
  MAX_TIMEOUT: 300000,             // 5 minutes
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY: 1000,          // 1 second
  MAX_BODY_SIZE: 1024 * 1024,      // 1MB
  RATE_LIMIT_WINDOW: 60000,        // 1 minute
  MAX_REQUESTS_PER_WINDOW: 50,
  TEMP_FILE_PREFIX: 'gh-safe-',
  ALLOWED_COMMANDS: [
    'auth', 'repo', 'issue', 'pr', 'release', 'gist', 'run', 'workflow', 
    'api', 'browse', 'config', 'extension', 'gpg-key', 'label', 'project',
    'secret', 'ssh-key', 'status', 'variable', 'cache', 'codespace'
  ],
  DANGEROUS_PATTERNS: [
    /\$\([^)]*\)/g,                // Command substitution $(...)
    /`[^`]*`/g,                    // Backtick execution
    /&&|\|\||;|&/g,                // Command chaining
    /<\(/g,                        // Process substitution
    />\s*\/dev\/null/g,            // Output redirection
    /\|\s*sh/g,                    // Pipe to shell
    /eval\s*\(/g,                  // eval() calls
    /exec\s*\(/g,                  // exec() calls
  ]
};

/**
 * Custom error classes for better error handling
 */
class GitHubCliError extends Error {
  constructor(message, code = 'GITHUB_CLI_ERROR', details = {}) {
    super(message);
    this.name = 'GitHubCliError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

class GitHubCliTimeoutError extends GitHubCliError {
  constructor(timeout, command) {
    super(`Command timed out after ${timeout}ms: ${command}`, 'TIMEOUT', { timeout, command });
    this.name = 'GitHubCliTimeoutError';
  }
}

class GitHubCliValidationError extends GitHubCliError {
  constructor(message, field, value) {
    super(message, 'VALIDATION_ERROR', { field, value });
    this.name = 'GitHubCliValidationError';
  }
}

class GitHubCliRateLimitError extends GitHubCliError {
  constructor(message) {
    super(message, 'RATE_LIMIT_ERROR');
    this.name = 'GitHubCliRateLimitError';
  }
}

/**
 * Rate limiter to prevent API abuse
 */
class RateLimiter {
  constructor(maxRequests = CONFIG.MAX_REQUESTS_PER_WINDOW, windowMs = CONFIG.RATE_LIMIT_WINDOW) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }

  async checkLimit() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = Math.min(...this.requests);
      const resetTime = oldestRequest + this.windowMs;
      const waitTime = resetTime - now;
      
      throw new GitHubCliRateLimitError(
        `Rate limit exceeded. Try again in ${Math.ceil(waitTime / 1000)} seconds`
      );
    }
    
    this.requests.push(now);
  }
}

/**
 * Main GitHub CLI Safety Wrapper Class
 */
export class GitHubCliSafe {
  constructor(options = {}) {
    this.options = {
      timeout: options.timeout || CONFIG.DEFAULT_TIMEOUT,
      maxRetries: options.maxRetries || CONFIG.MAX_RETRIES,
      retryDelay: options.retryDelay || CONFIG.RETRY_BASE_DELAY,
      enableRateLimit: options.enableRateLimit !== false,
      enableLogging: options.enableLogging !== false,
      tempDir: options.tempDir || tmpdir(),
      ...options
    };
    
    this.rateLimiter = new RateLimiter();
    this.activeProcesses = new Map();
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      retriedRequests: 0
    };
  }

  /**
   * Input validation and sanitization
   */
  validateCommand(command) {
    if (typeof command !== 'string' || !command.trim()) {
      throw new GitHubCliValidationError('Command must be a non-empty string', 'command', command);
    }

    const parts = command.trim().split(' ');
    const mainCommand = parts[0];
    
    if (!CONFIG.ALLOWED_COMMANDS.includes(mainCommand)) {
      throw new GitHubCliValidationError(
        `Command '${mainCommand}' is not allowed`, 
        'command', 
        mainCommand
      );
    }

    return command;
  }

  sanitizeInput(input) {
    if (typeof input !== 'string') {
      input = String(input);
    }

    // Check for dangerous patterns
    for (const pattern of CONFIG.DANGEROUS_PATTERNS) {
      if (pattern.test(input)) {
        throw new GitHubCliValidationError(
          `Input contains potentially dangerous pattern: ${pattern}`,
          'input',
          input
        );
      }
    }

    return input;
  }

  validateBodySize(body) {
    if (Buffer.byteLength(body, 'utf8') > CONFIG.MAX_BODY_SIZE) {
      throw new GitHubCliValidationError(
        `Body size exceeds maximum allowed size of ${CONFIG.MAX_BODY_SIZE} bytes`,
        'body',
        body.length
      );
    }
  }

  /**
   * Secure temporary file handling
   */
  async createSecureTempFile(content, suffix = '.tmp') {
    const filename = `${CONFIG.TEMP_FILE_PREFIX}${randomBytes(16).toString('hex')}${suffix}`;
    const filepath = resolve(this.options.tempDir, filename);
    
    // Validate content size
    this.validateBodySize(content);
    
    // Create file with restricted permissions (600 - owner read/write only)
    await fs.writeFile(filepath, content, { mode: 0o600 });
    
    return filepath;
  }

  async cleanupTempFile(filepath) {
    try {
      await fs.unlink(filepath);
    } catch (error) {
      if (this.options.enableLogging) {
        console.warn(`Failed to cleanup temp file ${filepath}:`, error.message);
      }
    }
  }

  /**
   * Process management with timeout and cleanup
   */
  async executeWithTimeout(command, args, options = {}) {
    const timeout = Math.min(options.timeout || this.options.timeout, CONFIG.MAX_TIMEOUT);
    const processId = randomBytes(8).toString('hex');
    
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      
      const child = spawn('gh', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false, // Critical: prevent shell injection
        env: { ...process.env, ...options.env },
        cwd: options.cwd || process.cwd()
      });

      this.activeProcesses.set(processId, child);
      
      let stdout = '';
      let stderr = '';
      let isTimedOut = false;
      let isResolved = false;

      // Timeout handler
      const timer = setTimeout(() => {
        if (!isResolved) {
          isTimedOut = true;
          this.killProcess(child, processId);
          this.stats.timeoutRequests++;
          reject(new GitHubCliTimeoutError(timeout, `gh ${args.join(' ')}`));
        }
      }, timeout);

      // Data handlers
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Process completion handler
      child.on('close', (code, signal) => {
        if (isResolved) return;
        
        isResolved = true;
        clearTimeout(timer);
        this.activeProcesses.delete(processId);
        
        const duration = performance.now() - startTime;
        
        if (isTimedOut) {
          return; // Already handled by timeout
        }

        if (signal === 'SIGKILL' || signal === 'SIGTERM') {
          reject(new GitHubCliError(
            `Process terminated by signal ${signal}`,
            'PROCESS_TERMINATED',
            { signal, code, duration }
          ));
          return;
        }

        if (code !== 0) {
          this.stats.failedRequests++;
          reject(new GitHubCliError(
            `Command failed with exit code ${code}: ${stderr || 'No error details'}`,
            'COMMAND_FAILED',
            { code, stderr, stdout, duration, command: `gh ${args.join(' ')}` }
          ));
          return;
        }

        this.stats.successfulRequests++;
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code,
          duration,
          command: `gh ${args.join(' ')}`
        });
      });

      // Error handler
      child.on('error', (error) => {
        if (isResolved) return;
        
        isResolved = true;
        clearTimeout(timer);
        this.activeProcesses.delete(processId);
        this.stats.failedRequests++;
        
        reject(new GitHubCliError(
          `Process error: ${error.message}`,
          'PROCESS_ERROR',
          { originalError: error }
        ));
      });
    });
  }

  killProcess(child, processId) {
    try {
      // Graceful termination first
      child.kill('SIGTERM');
      
      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (this.activeProcesses.has(processId)) {
          child.kill('SIGKILL');
          this.activeProcesses.delete(processId);
        }
      }, 5000);
    } catch (error) {
      if (this.options.enableLogging) {
        console.warn(`Failed to kill process ${processId}:`, error.message);
      }
    }
  }

  /**
   * Retry logic with exponential backoff
   */
  async withRetry(operation, maxRetries = this.options.maxRetries) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.stats.retriedRequests++;
          const delay = this.options.retryDelay * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
        
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Don't retry on validation errors or rate limits
        if (error instanceof GitHubCliValidationError || 
            error instanceof GitHubCliRateLimitError) {
          throw error;
        }
        
        if (attempt === maxRetries) {
          break;
        }
        
        if (this.options.enableLogging) {
          console.warn(`Attempt ${attempt + 1} failed, retrying:`, error.message);
        }
      }
    }
    
    throw lastError;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Core execution method with all safety features
   */
  async execute(command, options = {}) {
    this.stats.totalRequests++;
    
    // Rate limiting check
    if (this.options.enableRateLimit) {
      await this.rateLimiter.checkLimit();
    }
    
    // Validate and sanitize command
    const validatedCommand = this.validateCommand(command);
    const args = validatedCommand.split(' ');
    
    // Handle body content if provided
    let tempFile = null;
    try {
      if (options.body) {
        const sanitizedBody = this.sanitizeInput(options.body);
        tempFile = await this.createSecureTempFile(sanitizedBody);
        args.push('--body-file', tempFile);
      }
      
      // Add other options
      if (options.title) {
        args.push('--title', this.sanitizeInput(options.title));
      }
      
      if (options.labels && Array.isArray(options.labels)) {
        const sanitizedLabels = options.labels.map(label => this.sanitizeInput(label));
        args.push('--label', sanitizedLabels.join(','));
      }
      
      if (options.assignees && Array.isArray(options.assignees)) {
        const sanitizedAssignees = options.assignees.map(assignee => this.sanitizeInput(assignee));
        args.push('--assignee', sanitizedAssignees.join(','));
      }
      
      // Add any additional flags
      if (options.flags) {
        for (const [flag, value] of Object.entries(options.flags)) {
          args.push(`--${flag}`);
          if (value !== true) {
            args.push(this.sanitizeInput(String(value)));
          }
        }
      }
      
      // Execute with retry logic
      return await this.withRetry(async () => {
        return await this.executeWithTimeout(validatedCommand, args.slice(1), options);
      });
      
    } finally {
      // Always cleanup temp file
      if (tempFile) {
        await this.cleanupTempFile(tempFile);
      }
    }
  }

  /**
   * High-level methods for common GitHub operations
   */
  async createIssue({ title, body, labels = [], assignees = [], ...options }) {
    return await this.execute('issue create', {
      title,
      body,
      labels,
      assignees,
      ...options
    });
  }

  async createPR({ title, body, base = 'main', head, draft = false, ...options }) {
    const flags = { base };
    if (head) flags.head = head;
    if (draft) flags.draft = true;
    
    return await this.execute('pr create', {
      title,
      body,
      flags,
      ...options
    });
  }

  async addIssueComment(issueNumber, body, options = {}) {
    return await this.execute(`issue comment ${issueNumber}`, {
      body,
      ...options
    });
  }

  async addPRComment(prNumber, body, options = {}) {
    return await this.execute(`pr comment ${prNumber}`, {
      body,
      ...options
    });
  }

  async createRelease({ tag, title, body, prerelease = false, draft = false, ...options }) {
    const flags = { tag };
    if (prerelease) flags.prerelease = true;
    if (draft) flags.draft = true;
    
    return await this.execute('release create', {
      title,
      body,
      flags,
      ...options
    });
  }

  /**
   * Utility methods
   */
  async checkGitHubCli() {
    try {
      execSync('gh --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async checkAuthentication() {
    try {
      const result = await this.execute('auth status');
      return result.code === 0;
    } catch {
      return false;
    }
  }

  getStats() {
    return { ...this.stats };
  }

  getActiveProcessCount() {
    return this.activeProcesses.size;
  }

  async cleanup() {
    // Kill all active processes
    for (const [processId, child] of this.activeProcesses) {
      this.killProcess(child, processId);
    }
    this.activeProcesses.clear();
  }
}

/**
 * Factory function for creating configured instances
 */
export function createGitHubCliSafe(options = {}) {
  return new GitHubCliSafe(options);
}

/**
 * Default singleton instance
 */
export const githubCli = new GitHubCliSafe();

/**
 * Legacy compatibility functions
 */
export async function safeGhCommand(command, target, body, options = {}) {
  return await githubCli.execute(`${command} ${target}`, { body, ...options });
}

export const gh = {
  async issueComment(issue, body, options = {}) {
    return await githubCli.addIssueComment(issue, body, options);
  },
  
  async prComment(pr, body, options = {}) {
    return await githubCli.addPRComment(pr, body, options);
  },
  
  async createIssue(params) {
    return await githubCli.createIssue(params);
  },
  
  async createPR(params) {
    return await githubCli.createPR(params);
  }
};

/**
 * Process cleanup on exit
 */
process.on('SIGINT', async () => {
  await githubCli.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await githubCli.cleanup();
  process.exit(0);
});

export default GitHubCliSafe;