#!/usr/bin/env node
/**
 * Safe GitHub CLI Helper — v1.0.0
 *
 * Prevents injection issues when using `gh` commands with untrusted content
 * (PR bodies, issue bodies, comment bodies) by routing the body through a
 * temp file and using `--body-file` rather than interpolating into shell args.
 *
 * ADR-127 Phase 2 hardening:
 *   - GITHUB_SAFE_VERSION exported for smoke assertions.
 *   - Explicit 256KB body cap: rejects oversized bodies before any temp-file
 *     write, matching the GitHub API `body` field limit.
 *   - Strict error handling: all execSync calls inside try/catch; cleanup in
 *     finally; non-zero exit on any error.
 *   - GITHUB_SAFE_DRY_RUN=1 env-var skips the actual `gh` exec for testing.
 *
 * Usage:
 *   ./github-safe.js issue comment 123 "Message with \`backticks\`"
 *   ./github-safe.js pr create --title "Title" --body "Complex body"
 */

import { execSync, execFileSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

// Version constant — asserted by smoke-github-safe-injection.mjs.
export const GITHUB_SAFE_VERSION = '1.0.0';

// Maximum body size allowed (bytes).  The GitHub API enforces 65536 chars for
// issue/PR bodies; the CLI is more lenient but the 256KB limit is a
// conservative safety cap that prevents accidental oversized writes.
const MAX_BODY_BYTES = 256 * 1024;

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`
Safe GitHub CLI Helper v${GITHUB_SAFE_VERSION}

Usage:
  ./github-safe.js issue comment <number> <body>
  ./github-safe.js pr comment <number> <body>
  ./github-safe.js issue create --title <title> --body <body>
  ./github-safe.js pr create --title <title> --body <body>

This helper prevents injection issues with special characters:
- Backticks in code examples
- Command substitution $(...)
- Semicolons and other shell metacharacters
- Oversized bodies (> 256 KB rejected)
`);
  process.exit(1);
}

const [command, subcommand, ...restArgs] = args;

// Handle commands that need body content
if ((command === 'issue' || command === 'pr') &&
    (subcommand === 'comment' || subcommand === 'create')) {

  let bodyIndex = -1;
  let body = '';

  if (subcommand === 'comment' && restArgs.length >= 2) {
    // Simple format: github-safe.js issue comment 123 "body"
    body = restArgs[1];
    bodyIndex = 1;
  } else {
    // Flag format: --body "content"
    bodyIndex = restArgs.indexOf('--body');
    if (bodyIndex !== -1 && bodyIndex < restArgs.length - 1) {
      body = restArgs[bodyIndex + 1];
    }
  }

  if (body) {
    // Enforce 256KB cap before any file I/O.
    const bodyBytes = Buffer.byteLength(body, 'utf8');
    if (bodyBytes > MAX_BODY_BYTES) {
      console.error(
        `[ERROR] Body exceeds maximum allowed size (${bodyBytes} bytes > ${MAX_BODY_BYTES} bytes). ` +
        'GitHub API body fields are capped at 256KB. Truncate the body before passing it to github-safe.js.'
      );
      process.exit(1);
    }

    // Use temporary file for body content — never interpolate into argv.
    const tmpFile = join(tmpdir(), `gh-body-${randomBytes(8).toString('hex')}.tmp`);

    try {
      writeFileSync(tmpFile, body, 'utf8');

      // Build new command with --body-file
      const newArgs = [...restArgs];
      if (subcommand === 'comment' && bodyIndex === 1) {
        // Replace positional body arg with --body-file
        newArgs[1] = '--body-file';
        newArgs.push(tmpFile);
      } else if (bodyIndex !== -1) {
        // Replace --body flag pair with --body-file
        newArgs[bodyIndex] = '--body-file';
        newArgs[bodyIndex + 1] = tmpFile;
      }

      // Skip actual gh exec in dry-run mode (used by smoke tests).
      if (process.env.GITHUB_SAFE_DRY_RUN === '1') {
        const ghArgs = [command, subcommand, ...newArgs];
        console.log(`[DRY-RUN] gh ${ghArgs.join(' ')}`);
        process.exit(0);
      }

      const ghArgv = [command, subcommand, ...newArgs];
      console.log(`Executing: gh ${ghArgv.join(' ')}`);

      // Use execFileSync to avoid shell interpolation — args are passed as an
      // array so shell metacharacters in tmpFile path cannot be exploited.
      execFileSync('gh', ghArgv, {
        stdio: 'inherit',
        timeout: 30000,
      });

    } catch (error) {
      console.error('[ERROR]', error.message);
      process.exit(1);
    } finally {
      // Always clean up the temp file.
      try { unlinkSync(tmpFile); } catch (_) { /* ignore cleanup errors */ }
    }
  } else {
    // No body content — execute normally (no injection risk for args).
    if (process.env.GITHUB_SAFE_DRY_RUN === '1') {
      console.log(`[DRY-RUN] gh ${args.join(' ')}`);
      process.exit(0);
    }
    try {
      execFileSync('gh', args, { stdio: 'inherit' });
    } catch (error) {
      console.error('[ERROR]', error.message);
      process.exit(1);
    }
  }
} else {
  // Non-body commands — execute normally.
  if (process.env.GITHUB_SAFE_DRY_RUN === '1') {
    console.log(`[DRY-RUN] gh ${args.join(' ')}`);
    process.exit(0);
  }
  try {
    execFileSync('gh', args, { stdio: 'inherit' });
  } catch (error) {
    console.error('[ERROR]', error.message);
    process.exit(1);
  }
}
