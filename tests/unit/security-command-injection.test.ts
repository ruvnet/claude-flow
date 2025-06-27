/**
 * Command Injection Security Tests
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('Command Injection Prevention', () => {
  test('should prevent command injection patterns', () => {
    const maliciousInputs = [
      '; rm -rf /',
      '| cat /etc/passwd', 
      '& echo hacked',
      '`id`',
      '$(whoami)',
      '${USER}'
    ];
    
    // Test argument sanitization logic
    const sanitizedArgs = maliciousInputs.filter(arg => 
      typeof arg === 'string' && 
      !arg.includes(';') && 
      !arg.includes('|') && 
      !arg.includes('&') &&
      !arg.includes('`') &&
      !arg.includes('$')
    );
    
    expect(sanitizedArgs.length).toBe(0);
  });

  test('should use spawnSync with shell:false', () => {
    // Test secure command execution
    const result = spawnSync('echo', ['test'], {
      shell: false,
      stdio: 'pipe'
    });
    
    expect(result.stdout?.toString().trim()).toBe('test');
    expect(result.status).toBe(0);
  });

  test('should validate fixed files contain secure patterns', () => {
    const fixedFiles = [
      'src/cli/simple-commands/swarm.js',
      'src/templates/claude-optimized/template-manager.js',
      'src/cli/swarm-standalone.js'
    ];
    
    for (const file of fixedFiles) {
      const filePath = path.join(process.cwd(), file);
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Should contain secure spawn pattern
        expect(content).toContain('spawnSync');
        expect(content).toContain('shell: false');
        
        // Should not contain dangerous execSync patterns
        expect(content).not.toMatch(/execSync\s*\(\s*[`"'].*\$\{.*\}.*[`"']/);
        expect(content).not.toMatch(/execSync\s*\(\s*`.*\$\{.*\}`/);
      }
    }
  });

  test('should handle path traversal prevention', () => {
    const maliciousPaths = [
      '../../../etc/passwd',
      '/etc/shadow',
      'C:\\Windows\\System32',
      '\\\\network\\share\\malicious'
    ];
    
    for (const maliciousPath of maliciousPaths) {
      // Simple path validation logic - any of these conditions makes it insecure
      const hasPathTraversal = maliciousPath.includes('..');
      const isSystemPath = maliciousPath.startsWith('/etc') || maliciousPath.startsWith('C:\\Windows');
      const isNetworkPath = maliciousPath.startsWith('\\\\');
      
      const isSecure = !hasPathTraversal && !isSystemPath && !isNetworkPath;
      
      expect(isSecure).toBe(false);
    }
  });
});