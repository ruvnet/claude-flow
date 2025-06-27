#!/usr/bin/env node
/**
 * Permission Manager for Claude Flow
 * Replaces Deno's built-in permission system for Node.js environment
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class PermissionManager {
  constructor() {
    this.permissions = {
      read: new Set(),
      write: new Set(),
      net: new Set(),
      env: new Set(),
      run: new Set(),
      ffi: false,
      hrtime: false
    };
    
    this.deniedActions = new Set();
    this.permissionFile = path.join(process.cwd(), '.claude', 'permissions.json');
    this.loadPermissions();
  }

  loadPermissions() {
    try {
      if (fs.existsSync(this.permissionFile)) {
        const data = JSON.parse(fs.readFileSync(this.permissionFile, 'utf8'));
        this.permissions = { ...this.permissions, ...data };
      }
    } catch (error) {
      console.warn('Failed to load permissions:', error.message);
    }
  }

  savePermissions() {
    try {
      const dir = path.dirname(this.permissionFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.permissionFile, JSON.stringify(this.permissions, null, 2));
    } catch (error) {
      console.warn('Failed to save permissions:', error.message);
    }
  }

  /**
   * Check if path access is allowed
   */
  checkPath(action, targetPath) {
    const normalizedPath = path.resolve(targetPath);
    const allowedPaths = this.permissions[action];
    
    if (!allowedPaths || allowedPaths.size === 0) {
      return false;
    }

    // Check if any allowed path is a parent of target path
    for (const allowedPath of allowedPaths) {
      const normalizedAllowed = path.resolve(allowedPath);
      if (normalizedPath.startsWith(normalizedAllowed)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check network access
   */
  checkNetwork(url) {
    if (this.permissions.net.has('*')) {
      return true;
    }
    
    try {
      const urlObj = new URL(url);
      const host = urlObj.hostname;
      const port = urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80');
      
      return this.permissions.net.has(host) || 
             this.permissions.net.has(`${host}:${port}`) ||
             this.permissions.net.has(`${urlObj.protocol}//${host}`);
    } catch {
      return false;
    }
  }

  /**
   * Check environment variable access
   */
  checkEnv(varName) {
    return this.permissions.env.has('*') || this.permissions.env.has(varName);
  }

  /**
   * Check command execution
   */
  checkRun(command) {
    if (this.permissions.run.has('*')) {
      return true;
    }
    
    const cmdName = command.split(' ')[0];
    return this.permissions.run.has(command) || this.permissions.run.has(cmdName);
  }

  /**
   * Request permission interactively
   */
  async requestPermission(type, resource, reason = '') {
    if (process.env.CLAUDE_FLOW_AUTO_PERMISSIONS === 'true') {
      return this.grantPermission(type, resource);
    }

    // In automated environments, deny by default
    if (process.env.CI || process.env.NODE_ENV === 'test') {
      console.warn(`Permission denied: ${type} access to ${resource}`);
      return false;
    }

    console.log(`\n🔒 Permission Request:`);
    console.log(`Type: ${type}`);
    console.log(`Resource: ${resource}`);
    if (reason) console.log(`Reason: ${reason}`);
    
    // For now, auto-grant in development but log the request
    if (process.env.NODE_ENV === 'development') {
      console.log('✅ Auto-granted (development mode)');
      return this.grantPermission(type, resource);
    }
    
    // In production, require explicit permission
    console.log('❌ Permission denied (production mode)');
    return false;
  }

  grantPermission(type, resource) {
    if (type === 'read' || type === 'write') {
      this.permissions[type].add(resource);
    } else if (type === 'net') {
      this.permissions.net.add(resource);
    } else if (type === 'env') {
      this.permissions.env.add(resource);
    } else if (type === 'run') {
      this.permissions.run.add(resource);
    } else {
      this.permissions[type] = true;
    }
    
    this.savePermissions();
    return true;
  }

  /**
   * Secure file read with permission check
   */
  async secureReadFile(filePath, options = {}) {
    if (!this.checkPath('read', filePath)) {
      const granted = await this.requestPermission('read', filePath, 'File read access');
      if (!granted) {
        throw new Error(`Permission denied: Cannot read ${filePath}`);
      }
    }

    // Additional security checks
    const normalizedPath = path.resolve(filePath);
    
    // Prevent path traversal
    if (normalizedPath.includes('..')) {
      throw new Error('Path traversal detected');
    }
    
    // Check for dangerous file types
    const ext = path.extname(normalizedPath).toLowerCase();
    const dangerousExts = ['.exe', '.bat', '.cmd', '.sh', '.ps1'];
    if (dangerousExts.includes(ext)) {
      console.warn(`Warning: Reading potentially dangerous file type: ${ext}`);
    }

    return fs.readFileSync(filePath, options);
  }

  /**
   * Secure file write with permission check
   */
  async secureWriteFile(filePath, data, options = {}) {
    if (!this.checkPath('write', filePath)) {
      const granted = await this.requestPermission('write', filePath, 'File write access');
      if (!granted) {
        throw new Error(`Permission denied: Cannot write to ${filePath}`);
      }
    }

    const normalizedPath = path.resolve(filePath);
    
    // Prevent path traversal
    if (normalizedPath.includes('..')) {
      throw new Error('Path traversal detected');
    }
    
    // Prevent writing to sensitive system locations
    const systemPaths = ['/etc', '/usr', '/var', '/System', 'C:\\Windows', 'C:\\Program Files'];
    if (systemPaths.some(sysPath => normalizedPath.startsWith(sysPath))) {
      throw new Error('Cannot write to system directory');
    }

    return fs.writeFileSync(filePath, data, options);
  }

  /**
   * Secure command execution
   */
  async secureSpawn(command, args = [], options = {}) {
    const fullCommand = `${command} ${args.join(' ')}`;
    
    if (!this.checkRun(command)) {
      const granted = await this.requestPermission('run', command, 'Command execution');
      if (!granted) {
        throw new Error(`Permission denied: Cannot execute ${command}`);
      }
    }

    // Validate command and arguments
    if (typeof command !== 'string' || !command.trim()) {
      throw new Error('Invalid command');
    }

    // Check for shell injection patterns
    const dangerousPatterns = [';', '|', '&', '$', '`', '$(', '${'];
    if (dangerousPatterns.some(pattern => command.includes(pattern))) {
      throw new Error('Potentially dangerous command detected');
    }

    // Validate arguments
    for (const arg of args) {
      if (typeof arg !== 'string') {
        throw new Error('All arguments must be strings');
      }
      if (dangerousPatterns.some(pattern => arg.includes(pattern))) {
        console.warn(`Warning: Potentially dangerous argument: ${arg}`);
      }
    }

    // Force secure options
    const secureOptions = {
      ...options,
      shell: false, // Always disable shell
      stdio: options.stdio || 'inherit'
    };

    const { spawnSync } = await import('child_process');
    return spawnSync(command, args, secureOptions);
  }

  /**
   * Initialize default permissions for development
   */
  initializeDevPermissions() {
    // Grant basic permissions for development
    this.grantPermission('read', process.cwd());
    this.grantPermission('write', process.cwd());
    this.grantPermission('env', 'NODE_ENV');
    this.grantPermission('env', 'PATH');
    this.grantPermission('run', 'node');
    this.grantPermission('run', 'npm');
    this.grantPermission('run', 'git');
    this.grantPermission('net', 'api.anthropic.com');
    this.grantPermission('net', 'localhost');
    
    console.log('✅ Development permissions initialized');
  }

  /**
   * Reset all permissions (for testing)
   */
  resetPermissions() {
    this.permissions = {
      read: new Set(),
      write: new Set(), 
      net: new Set(),
      env: new Set(),
      run: new Set(),
      ffi: false,
      hrtime: false
    };
    this.savePermissions();
  }

  /**
   * Get permission summary
   */
  getPermissionSummary() {
    return {
      read: Array.from(this.permissions.read),
      write: Array.from(this.permissions.write),
      net: Array.from(this.permissions.net),
      env: Array.from(this.permissions.env),
      run: Array.from(this.permissions.run),
      ffi: this.permissions.ffi,
      hrtime: this.permissions.hrtime
    };
  }
}

// Export singleton instance
export const permissionManager = new PermissionManager();

// Initialize development permissions if in dev mode
if (process.env.NODE_ENV === 'development') {
  permissionManager.initializeDevPermissions();
}

export default PermissionManager;