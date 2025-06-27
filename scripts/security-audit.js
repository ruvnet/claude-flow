#!/usr/bin/env node
/**
 * Security Audit Script for Claude Flow
 * Runs comprehensive security checks
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { checkVulnerableDependencies, SECURITY_CONFIG } from '../src/security/security-config.js';

console.log('🔒 Claude Flow Security Audit');
console.log('==============================\n');

let auditResults = {
  passed: 0,
  failed: 0,
  warnings: 0,
  issues: []
};

function logResult(test, status, message = '') {
  const symbols = {
    pass: '✅',
    fail: '❌', 
    warn: '⚠️'
  };
  
  console.log(`${symbols[status]} ${test}${message ? `: ${message}` : ''}`);
  
  if (status === 'pass') auditResults.passed++;
  else if (status === 'fail') {
    auditResults.failed++;
    auditResults.issues.push({ test, message });
  } else if (status === 'warn') {
    auditResults.warnings++;
    auditResults.issues.push({ test, message, severity: 'warning' });
  }
}

// 1. Check for command injection vulnerabilities
console.log('1. Command Injection Vulnerability Check');
console.log('-'.repeat(40));

const vulnerableFiles = [
  'src/cli/simple-commands/swarm.js',
  'src/templates/claude-optimized/template-manager.js',
  'src/cli/swarm-standalone.js'
];

for (const file of vulnerableFiles) {
  const filePath = path.join(process.cwd(), file);
  
  if (!fs.existsSync(filePath)) {
    logResult(`File exists: ${file}`, 'fail', 'File not found');
    continue;
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check for dangerous execSync patterns
  const dangerousPatterns = [
    /execSync\s*\(\s*[`"'].*\$\{.*\}.*[`"']/,  // Template literal injection
    /execSync\s*\(\s*[`"'].*\+.*[`"']/,       // String concatenation injection
    /execSync\s*\(\s*`.*\$\{.*\}`/,           // Template literal with variables
    /execSync\s*\([^)]*\+[^)]*\)/             // Any string concatenation
  ];
  
  let hasVulnerability = false;
  for (const pattern of dangerousPatterns) {
    if (pattern.test(content)) {
      hasVulnerability = true;
      break;
    }
  }
  
  if (hasVulnerability) {
    logResult(`Command injection check: ${file}`, 'fail', 'Vulnerable execSync usage found');
  } else {
    // Check if spawnSync is used with shell:false
    const hasSecureSpawn = content.includes('spawnSync') && content.includes('shell: false');
    if (hasSecureSpawn) {
      logResult(`Command injection check: ${file}`, 'pass', 'Uses secure spawnSync');
    } else if (content.includes('execSync')) {
      logResult(`Command injection check: ${file}`, 'warn', 'Contains execSync but may be safe');
    } else {
      logResult(`Command injection check: ${file}`, 'pass', 'No command execution found');
    }
  }
}

// 2. Dependency vulnerability check
console.log('\n2. Dependency Vulnerability Check');
console.log('-'.repeat(40));

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vulnerabilities = checkVulnerableDependencies(packageJson);

if (vulnerabilities.length === 0) {
  logResult('No known vulnerable dependencies', 'pass');
} else {
  for (const vuln of vulnerabilities) {
    if (vuln.severity === 'moderate' && vuln.package === 'pkg') {
      logResult(`${vuln.package}@${vuln.version}`, 'warn', `${vuln.severity}: ${vuln.description}`);
    } else if (vuln.severity === 'high' || vuln.severity === 'critical') {
      logResult(`${vuln.package}@${vuln.version}`, 'fail', `${vuln.severity}: ${vuln.reason}`);
    } else {
      logResult(`${vuln.package}@${vuln.version}`, 'warn', `${vuln.severity}: ${vuln.reason}`);
    }
  }
}

// 3. Run npm audit
console.log('\n3. NPM Audit Check');
console.log('-'.repeat(40));

const auditResult = spawnSync('npm', ['audit', '--json'], {
  stdio: 'pipe',
  shell: false
});

if (auditResult.stdout) {
  try {
    const audit = JSON.parse(auditResult.stdout.toString());
    if (audit.metadata && audit.metadata.vulnerabilities) {
      const total = audit.metadata.vulnerabilities.total;
      const critical = audit.metadata.vulnerabilities.critical || 0;
      const high = audit.metadata.vulnerabilities.high || 0;
      const moderate = audit.metadata.vulnerabilities.moderate || 0;
      const low = audit.metadata.vulnerabilities.low || 0;
      
      if (total === 0) {
        logResult('NPM audit', 'pass', 'No vulnerabilities found');
      } else {
        const message = `${total} vulnerabilities (Critical: ${critical}, High: ${high}, Moderate: ${moderate}, Low: ${low})`;
        if (critical > 0 || high > 0) {
          logResult('NPM audit', 'fail', message);
        } else {
          logResult('NPM audit', 'warn', message);
        }
      }
    }
  } catch (e) {
    logResult('NPM audit', 'warn', 'Could not parse audit results');
  }
} else {
  logResult('NPM audit', 'warn', 'Could not run npm audit');
}

// 4. Permission system check
console.log('\n4. Permission System Check');
console.log('-'.repeat(40));

const permissionFile = 'src/security/permission-manager.js';
if (fs.existsSync(permissionFile)) {
  logResult('Permission manager exists', 'pass');
  
  const permContent = fs.readFileSync(permissionFile, 'utf8');
  
  // Check for key security features
  const securityFeatures = [
    'checkPath',
    'checkNetwork', 
    'checkRun',
    'secureSpawn',
    'shell: false',
    'path traversal'
  ];
  
  for (const feature of securityFeatures) {
    if (permContent.includes(feature)) {
      logResult(`Permission feature: ${feature}`, 'pass');
    } else {
      logResult(`Permission feature: ${feature}`, 'fail', 'Missing security feature');
    }
  }
} else {
  logResult('Permission manager exists', 'fail', 'Permission system not found');
}

// 5. Test suite check
console.log('\n5. Security Test Suite Check');
console.log('-'.repeat(40));

const testFile = 'tests/security/security-validation.test.ts';
if (fs.existsSync(testFile)) {
  logResult('Security test suite exists', 'pass');
  
  // Try to run the security tests
  console.log('\nRunning security tests...');
  const testResult = spawnSync('npm', ['test', '--', '--testPathPattern=security'], {
    stdio: 'pipe',
    shell: false
  });
  
  if (testResult.status === 0) {
    logResult('Security tests', 'pass', 'All security tests passed');
  } else {
    logResult('Security tests', 'fail', 'Some security tests failed');
    if (testResult.stderr) {
      console.log('Test errors:', testResult.stderr.toString());
    }
  }
} else {
  logResult('Security test suite exists', 'fail', 'Security tests not found');
}

// 6. Configuration check
console.log('\n6. Security Configuration Check');
console.log('-'.repeat(40));

const configFile = 'src/security/security-config.js';
if (fs.existsSync(configFile)) {
  logResult('Security configuration exists', 'pass');
} else {
  logResult('Security configuration exists', 'fail', 'Security config not found');
}

// 7. File permission check
console.log('\n7. File Permission Check');
console.log('-'.repeat(40));

const sensitiveFiles = [
  '.env',
  '.env.local',
  'private.key',
  'id_rsa',
  '.aws/credentials'
];

for (const file of sensitiveFiles) {
  if (fs.existsSync(file)) {
    logResult(`Sensitive file found: ${file}`, 'warn', 'Should be excluded from repository');
  }
}

// Check .gitignore
if (fs.existsSync('.gitignore')) {
  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  const protectedPatterns = ['.env', '*.key', '.aws/', 'node_modules/'];
  
  for (const pattern of protectedPatterns) {
    if (gitignore.includes(pattern)) {
      logResult(`Gitignore protects: ${pattern}`, 'pass');
    } else {
      logResult(`Gitignore protects: ${pattern}`, 'warn', 'Should be in .gitignore');
    }
  }
}

// Final results
console.log('\n🔒 Security Audit Results');
console.log('='.repeat(40));
console.log(`✅ Passed: ${auditResults.passed}`);
console.log(`⚠️  Warnings: ${auditResults.warnings}`);
console.log(`❌ Failed: ${auditResults.failed}`);

if (auditResults.issues.length > 0) {
  console.log('\n📋 Issues Found:');
  for (const issue of auditResults.issues) {
    const severity = issue.severity === 'warning' ? '⚠️' : '❌';
    console.log(`${severity} ${issue.test}: ${issue.message}`);
  }
}

console.log('\n📊 Security Score:', Math.round((auditResults.passed / (auditResults.passed + auditResults.failed)) * 100) + '%');

if (auditResults.failed === 0) {
  console.log('\n🎉 Security audit completed successfully!');
  process.exit(0);
} else {
  console.log('\n⚠️  Security issues found. Please address before deployment.');
  process.exit(1);
}