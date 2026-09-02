/**
 * Integration tests for portability fixes
 * Tests that non-portable commands have been replaced with cross-platform alternatives
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Portability Fixes Integration Tests', () => {
  describe('Source Code Verification', () => {
    test('ruv-swarm-wrapper.js should use structured error handling', async () => {
      const filePath = path.join(__dirname, '../../src/mcp/ruv-swarm-wrapper.js');
      const content = await readFile(filePath, 'utf8');
      
      // Verify structured error handling is present
      expect(content).toMatch(/error\.code/);
      expect(content).toMatch(/case 'LOGGER_METHOD_MISSING':/);
      expect(content).toMatch(/case 'ERR_LOGGER_MEMORY_USAGE':/);
      expect(content).toMatch(/knownErrorPatterns/);
      
      // Verify pattern-based fallback
      expect(content).toMatch(/pattern: \/logger\\\.logMemoryUsage is not a function\//);
      expect(content).toMatch(/code: 'LOGGER_METHOD_MISSING'/);
      
      // Should not use brittle string matching
      expect(content).not.toMatch(/line\.includes\('logger\.logMemoryUsage is not a function'\)/);
    });

    test('swarm-ui.js should not use pkill', async () => {
      const filePath = path.join(__dirname, '../../src/cli/simple-commands/swarm-ui.js');
      const content = await readFile(filePath, 'utf8');
      
      // Should not contain pkill
      expect(content).not.toMatch(/\bpkill\b/);
      
      // Should use process tracking
      expect(content).toMatch(/activeProcesses = new Map\(\)/);
      expect(content).toMatch(/this\.activeProcesses\.set/);
      expect(content).toMatch(/process\.kill\(/);
      
      // Should have cross-platform process termination
      expect(content).toMatch(/stopOrphanedProcesses/);
      expect(content).toMatch(/platform\(\) === 'win32'/);
      expect(content).toMatch(/taskkill/); // Windows
      expect(content).toMatch(/process\.kill\(parseInt\(pid\)/); // Unix
    });

    test('github.js should not use which command', async () => {
      const filePath = path.join(__dirname, '../../src/cli/simple-commands/github.js');
      const content = await readFile(filePath, 'utf8');
      
      // Should not use 'which' command
      expect(content).not.toMatch(/execSync\('which claude'/);
      
      // Should use cross-platform command checking
      expect(content).toMatch(/checkCommandAvailable/);
      expect(content).toMatch(/checkClaudeAvailable/);
      
      // Should handle Windows differently
      expect(content).toMatch(/platform\(\) === 'win32'/);
      expect(content).toMatch(/where \$\{command\}/); // Windows
      expect(content).toMatch(/command -v \$\{command\}/); // Unix
      
      // Should check common paths as fallback
      expect(content).toMatch(/\/usr\/local\/bin/);
      expect(content).toMatch(/access\(/);
      expect(content).toMatch(/constants\.X_OK/);
    });
  });

  describe('Error Handling Patterns', () => {
    test('should define consistent error codes', async () => {
      const filePath = path.join(__dirname, '../../src/mcp/ruv-swarm-wrapper.js');
      const content = await readFile(filePath, 'utf8');
      
      // Extract error codes from the source
      const errorCodeMatches = content.match(/case '([A-Z_]+)':/g) || [];
      const errorCodes = errorCodeMatches.map(match => match.replace(/case '|':/g, ''));
      
      // Verify error codes follow naming conventions
      const validPatterns = [
        /^ERR_[A-Z_]+$/,
        /^[A-Z_]+_ERROR$/,
        /^[A-Z_]+_MISSING$/,
        /^[A-Z_]+_NOT_FOUND$/,
        /^[A-Z_]+_REFUSED$/
      ];
      
      errorCodes.forEach(code => {
        const isValid = validPatterns.some(pattern => pattern.test(code));
        expect(isValid).toBe(true);
      });
    });
  });

  describe('Cross-Platform Compatibility', () => {
    test('should handle both Unix and Windows platforms', async () => {
      const files = [
        path.join(__dirname, '../../src/cli/simple-commands/swarm-ui.js'),
        path.join(__dirname, '../../src/cli/simple-commands/github.js')
      ];
      
      for (const filePath of files) {
        const content = await readFile(filePath, 'utf8');
        
        // Should check for platform
        expect(content).toMatch(/platform\(\)/);
        
        // Should have Windows-specific code
        expect(content).toMatch(/win32/);
        
        // Should have Unix-specific code  
        expect(content).toMatch(/else \{[\s\S]*?\/\/ Unix/);
      }
    });
  });

  describe('Process Management', () => {
    test('swarm-ui.js should properly track and terminate processes', async () => {
      const filePath = path.join(__dirname, '../../src/cli/simple-commands/swarm-ui.js');
      const content = await readFile(filePath, 'utf8');
      
      // Should track processes
      expect(content).toMatch(/activeProcesses\.set\(/);
      
      // Should clean up processes on exit
      expect(content).toMatch(/cleanup\(\)/);
      expect(content).toMatch(/activeProcesses\.clear\(\)/);
      
      // Should handle process termination gracefully
      expect(content).toMatch(/if \(process\.pid && !process\.killed\)/);
      expect(content).toMatch(/process\.kill\('SIGTERM'\)/);
    });
  });
});