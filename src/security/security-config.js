#!/usr/bin/env node
/**
 * Security Configuration for Claude Flow
 * Centralizes security settings and policies
 */

import path from 'path';

export const SECURITY_CONFIG = {
  // Command execution security
  ALLOWED_COMMANDS: [
    'node',
    'npm',
    'git',
    'deno',
    'which',
    'curl', // Only for approved APIs
    'ping'
  ],
  
  // Network security
  ALLOWED_HOSTS: [
    'api.anthropic.com',
    'localhost',
    '127.0.0.1',
    '::1'
  ],
  
  // File system security
  RESTRICTED_PATHS: [
    '/etc',
    '/usr',
    '/var',
    '/System',
    'C:\\Windows',
    'C:\\Program Files',
    '/root',
    '/home/*/.ssh'
  ],
  
  ALLOWED_FILE_EXTENSIONS: [
    '.js',
    '.ts',
    '.json',
    '.md',
    '.txt',
    '.log',
    '.yml',
    '.yaml',
    '.toml'
  ],
  
  DANGEROUS_FILE_EXTENSIONS: [
    '.exe',
    '.bat',
    '.cmd',
    '.sh',
    '.ps1',
    '.scr',
    '.com',
    '.dll'
  ],
  
  // Environment security
  SENSITIVE_ENV_VARS: [
    'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY',
    'SECRET_KEY',
    'PASSWORD',
    'TOKEN',
    'API_KEY',
    'SECRET',
    'PRIVATE_KEY'
  ],
  
  // Dependency security
  KNOWN_VULNERABLE_PACKAGES: [
    'event-stream',
    'flatmap-stream',
    'eslint-scope',
    'getcookies',
    'crossenv' // typosquatting
  ],
  
  // Content Security Policy
  CSP_HEADERS: {
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.anthropic.com; font-src 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
  },
  
  // Build security
  BUILD_SECURITY: {
    // Known issue: pkg@5.8.1 has moderate vulnerability
    // GHSA-22r3-9w55-cj54 - Local Privilege Escalation
    PKG_VULNERABILITY: {
      severity: 'moderate',
      description: 'Local Privilege Escalation in pkg',
      advisory: 'https://github.com/advisories/GHSA-22r3-9w55-cj54',
      mitigation: 'Only use in controlled build environments',
      status: 'no_fix_available'
    }
  }
};

/**
 * Validate command against security policy
 */
export function validateCommand(command) {
  const cmdName = command.split(' ')[0];
  
  if (!SECURITY_CONFIG.ALLOWED_COMMANDS.includes(cmdName)) {
    throw new Error(`Command not allowed: ${cmdName}`);
  }
  
  // Check for injection patterns
  const dangerousPatterns = [';', '|', '&', '$', '`', '$(', '${'];
  if (dangerousPatterns.some(pattern => command.includes(pattern))) {
    throw new Error('Potentially dangerous command pattern detected');
  }
  
  return true;
}

/**
 * Validate network access
 */
export function validateNetworkAccess(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    // Check against allowed hosts
    const isAllowed = SECURITY_CONFIG.ALLOWED_HOSTS.some(allowedHost => {
      if (allowedHost === hostname) return true;
      if (allowedHost.endsWith('.anthropic.com') && hostname.endsWith('.anthropic.com')) return true;
      return false;
    });
    
    if (!isAllowed) {
      throw new Error(`Network access not allowed: ${hostname}`);
    }
    
    return true;
  } catch (error) {
    throw new Error(`Invalid URL: ${url}`);
  }
}

/**
 * Validate file path
 */
export function validateFilePath(filePath) {
  const normalizedPath = path.resolve(filePath);
  
  // Check for path traversal
  if (normalizedPath.includes('..')) {
    throw new Error('Path traversal detected');
  }
  
  // Check against restricted paths
  for (const restrictedPath of SECURITY_CONFIG.RESTRICTED_PATHS) {
    if (normalizedPath.startsWith(restrictedPath)) {
      throw new Error(`Access to restricted path: ${restrictedPath}`);
    }
  }
  
  return true;
}

/**
 * Sanitize environment variables for logging
 */
export function sanitizeEnvVars(env) {
  const sanitized = { ...env };
  
  for (const sensitiveVar of SECURITY_CONFIG.SENSITIVE_ENV_VARS) {
    if (sanitized[sensitiveVar]) {
      sanitized[sensitiveVar] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

/**
 * Get security headers for HTTP responses
 */
export function getSecurityHeaders() {
  return SECURITY_CONFIG.CSP_HEADERS;
}

/**
 * Check for vulnerable dependencies
 */
export function checkVulnerableDependencies(packageJson) {
  const vulnerabilities = [];
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  };
  
  for (const vulnPkg of SECURITY_CONFIG.KNOWN_VULNERABLE_PACKAGES) {
    if (allDeps[vulnPkg]) {
      vulnerabilities.push({
        package: vulnPkg,
        version: allDeps[vulnPkg],
        severity: 'high',
        reason: 'Known vulnerable package'
      });
    }
  }
  
  // Check for pkg vulnerability
  if (allDeps.pkg) {
    vulnerabilities.push({
      package: 'pkg',
      version: allDeps.pkg,
      ...SECURITY_CONFIG.BUILD_SECURITY.PKG_VULNERABILITY
    });
  }
  
  return vulnerabilities;
}

export default SECURITY_CONFIG;