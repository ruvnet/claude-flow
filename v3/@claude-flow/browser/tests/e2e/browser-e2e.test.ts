/**
 * @claude-flow/browser - E2E Browser Tests
 *
 * These tests run against a real browser using agent-browser.
 * Run with: docker compose --profile e2e up browser-e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';

const TEST_URL = process.env.TEST_URL || 'http://localhost:3000';
const SESSION = 'e2e-test';

/**
 * Execute agent-browser command.
 *
 * The `command` argument is split on whitespace into discrete tokens so that
 * execFileSync can receive an argv array.  This prevents shell injection when
 * test fixtures contain special characters (CWE-78).
 */
function browser(command: string): string {
  try {
    // Split command into tokens and pass as array — no shell expansion.
    const argv = ['--session', SESSION, '--json', ...command.trim().split(/\s+/)];
    const result = execFileSync('agent-browser', argv, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    return result;
  } catch (error) {
    throw new Error(`Browser command failed: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Parse JSON result from agent-browser
 */
function parseResult(output: string): { success: boolean; data?: unknown; error?: string } {
  try {
    return JSON.parse(output);
  } catch {
    return { success: true, data: output.trim() };
  }
}

describe('Browser E2E Tests', () => {
  // Skip if not in E2E environment
  const runE2E = process.env.TEST_URL !== undefined;

  beforeAll(async () => {
    if (!runE2E) {
      console.log('Skipping E2E tests - TEST_URL not set');
      return;
    }

    // Open test page
    const result = browser(`open ${TEST_URL}`);
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
  });

  afterAll(async () => {
    if (!runE2E) return;

    // Close browser
    try {
      browser('close');
    } catch {
      // Ignore close errors
    }
  });

  describe('Navigation', () => {
    it.skipIf(!runE2E)('should navigate to test page', () => {
      const result = browser('get url');
      const parsed = parseResult(result);

      expect(parsed.success).toBe(true);
      expect(parsed.data).toContain(TEST_URL);
    });

    it.skipIf(!runE2E)('should get page title', () => {
      const result = browser('get title');
      const parsed = parseResult(result);

      expect(parsed.success).toBe(true);
      expect(parsed.data).toBe('Browser Test Page');
    });
  });

  describe('Snapshot', () => {
    it.skipIf(!runE2E)('should take accessibility snapshot', () => {
      const result = browser('snapshot');
      const parsed = parseResult(result);

      expect(parsed.success).toBe(true);
      expect(parsed.data).toBeDefined();
    });

    it.skipIf(!runE2E)('should get interactive elements only', () => {
      const result = browser('snapshot -i');
      const parsed = parseResult(result);

      expect(parsed.success).toBe(true);
      // Should have element refs like @e1, @e2
    });
  });

  describe('Form Interaction', () => {
    it.skipIf(!runE2E)('should fill email input', () => {
      // First get snapshot to find refs
      browser('snapshot -i');

      // Fill using CSS selector
      const result = browser('fill "#email" "test@example.com"');
      const parsed = parseResult(result);

      expect(parsed.success).toBe(true);
    });

    it.skipIf(!runE2E)('should fill password input', () => {
      const result = browser('fill "#password" "secretpassword"');
      const parsed = parseResult(result);

      expect(parsed.success).toBe(true);
    });

    it.skipIf(!runE2E)('should check checkbox', () => {
      const result = browser('check "#agree"');
      const parsed = parseResult(result);

      expect(parsed.success).toBe(true);
    });

    it.skipIf(!runE2E)('should submit form', () => {
      const result = browser('click "#submit-btn"');
      const parsed = parseResult(result);

      expect(parsed.success).toBe(true);
    });

    it.skipIf(!runE2E)('should see result after form submit', () => {
      // Wait for result to appear
      browser('wait "#result"');

      const result = browser('get text "#result-data"');
      const parsed = parseResult(result);

      expect(parsed.success).toBe(true);
      expect(parsed.data).toContain('test@example.com');
    });
  });

  describe('Screenshot', () => {
    it.skipIf(!runE2E)('should take screenshot', () => {
      const result = browser('screenshot');
      const parsed = parseResult(result);

      expect(parsed.success).toBe(true);
      // Should return base64 image data
    });
  });

  describe('JavaScript Execution', () => {
    it.skipIf(!runE2E)('should execute JavaScript', () => {
      const result = browser('eval "document.title"');
      const parsed = parseResult(result);

      expect(parsed.success).toBe(true);
      expect(parsed.data).toBe('Browser Test Page');
    });

    it.skipIf(!runE2E)('should extract data with JavaScript', () => {
      const result = browser('eval "document.getElementById(\'email\').value"');
      const parsed = parseResult(result);

      expect(parsed.success).toBe(true);
      expect(parsed.data).toBe('test@example.com');
    });
  });
});
