/**
 * WebUI Cross-Platform Validator
 * Validates that WebUI components work across Node.js and Deno
 */

import { compat } from '../runtime-detector.js';
import { promises as fs } from 'fs';

export class WebUIValidator {
  constructor() {
    this.tests = [];
    this.results = {
      passed: 0,
      failed: 0,
      total: 0,
    };
  }

  async runValidation() {
    console.log(`🔍 WebUI Cross-Platform Validation (${compat.runtime})`);
    console.log('─'.repeat(50));

    // Runtime Detection Test
    this.test('Runtime Detection', () => {
      const isValidRuntime = compat.runtime === 'node' || compat.runtime === 'deno';
      const hasPlatform = compat.platform && compat.platform.os;
      return isValidRuntime && hasPlatform;
    });

    // Terminal I/O Test
    this.test('Terminal I/O Layer', () => {
      const terminal = compat.terminal;
      const hasRequiredMethods =
        terminal &&
        typeof terminal.write === 'function' &&
        typeof terminal.read === 'function' &&
        typeof terminal.exit === 'function';
      return hasRequiredMethods;
    });

    // Component Import Test
    await this.asyncTest('Component Imports', async () => {
      try {
        await import('./start-wrapper.js');
        await import('./process-ui-enhanced.js');
        return true;
      } catch (err) {
        return false;
      }
    });

    // UI Instantiation Test
    await this.asyncTest('UI Instantiation', async () => {
      try {
        const { EnhancedProcessUI } = await import('./process-ui-enhanced.js');
        const ui = new EnhancedProcessUI();
        return ui && ui.processes && ui.processes.size > 0;
      } catch (err) {
        return false;
      }
    });

    // File Operations Test
    await this.asyncTest('File Operations', async () => {
      try {
        await compat.safeCall(async () => {
          if (compat.runtime === 'deno') {
            await fs.writeFile('.webui-test', 'test', 'utf8');
            await fs.unlink('.webui-test');
          } else {
            const fs = await import('fs/promises');
            await fs.writeFile('.webui-test', 'test', 'utf8');
            await fs.unlink('.webui-test');
          }
        });
        return true;
      } catch (err) {
        return false;
      }
    });

    this.printSummary();
    return this.results.failed === 0;
  }

  test(name, testFn) {
    this.results.total++;
    try {
      const result = testFn();
      if (result) {
        console.log(`✅ ${name}`);
        this.results.passed++;
      } else {
        console.log(`❌ ${name}`);
        this.results.failed++;
      }
    } catch (err) {
      console.log(`❌ ${name}: ${err.message}`);
      this.results.failed++;
    }
  }

  async asyncTest(name, testFn) {
    this.results.total++;
    try {
      const result = await testFn();
      if (result) {
        console.log(`✅ ${name}`);
        this.results.passed++;
      } else {
        console.log(`❌ ${name}`);
        this.results.failed++;
      }
    } catch (err) {
      console.log(`❌ ${name}: ${err.message}`);
      this.results.failed++;
    }
  }

  printSummary() {
    console.log('─'.repeat(50));
    console.log(`📊 Results: ${this.results.passed}/${this.results.total} passed`);
    if (this.results.failed === 0) {
      console.log('🎉 All validations passed! WebUI is cross-platform compatible.');
    } else {
      console.log(`⚠️  ${this.results.failed} validation(s) failed.`);
    }
  }
}

// Auto-run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new WebUIValidator();
  const success = await validator.runValidation();
  process.exit(success ? 0 : 1);
}
