/**
 * Test for settings.local.json creation during init command
 * Issue #162: init command does not create .claude/settings.local.json
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

describe('Init Command - settings.local.json Creation', () => {
  let testDir;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `claude-flow-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    process.chdir(testDir);
  });

  afterEach(async () => {
    // Clean up test directory
    process.chdir(os.tmpdir());
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should create .claude/settings.local.json with default MCP permissions', async () => {
    // Run init command
    execSync('npx claude-flow init', {
      cwd: testDir,
      stdio: 'pipe',
      env: { ...process.env, PATH: `/workspaces/claude-code-flow/node_modules/.bin:${process.env.PATH}` }
    });

    // Check if settings.local.json exists
    const settingsLocalPath = path.join(testDir, '.claude', 'settings.local.json');
    const exists = await fs.access(settingsLocalPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    // Read and parse settings.local.json
    const content = await fs.readFile(settingsLocalPath, 'utf8');
    const settings = JSON.parse(content);

    // Verify structure
    expect(settings).toHaveProperty('permissions');
    expect(settings.permissions).toHaveProperty('allow');
    expect(settings.permissions).toHaveProperty('deny');

    // Verify default MCP permissions
    expect(settings.permissions.allow).toContain('mcp__ruv-swarm');
    expect(settings.permissions.allow).toContain('mcp__claude-flow');
    expect(settings.permissions.deny).toEqual([]);
  });

  it('should not create settings.local.json in dry-run mode', async () => {
    // Run init command with --dry-run
    execSync('npx claude-flow init --dry-run', {
      cwd: testDir,
      stdio: 'pipe',
      env: { ...process.env, PATH: `/workspaces/claude-code-flow/node_modules/.bin:${process.env.PATH}` }
    });

    // Check that settings.local.json does not exist
    const settingsLocalPath = path.join(testDir, '.claude', 'settings.local.json');
    const exists = await fs.access(settingsLocalPath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('should overwrite settings.local.json with --force flag', async () => {
    // Create initial settings.local.json with different content
    const claudeDir = path.join(testDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    
    const customSettings = {
      permissions: {
        allow: ['custom-tool'],
        deny: ['blocked-tool']
      }
    };
    
    const settingsLocalPath = path.join(claudeDir, 'settings.local.json');
    await fs.writeFile(settingsLocalPath, JSON.stringify(customSettings, null, 2));

    // Run init command with --force
    execSync('npx claude-flow init --force', {
      cwd: testDir,
      stdio: 'pipe',
      env: { ...process.env, PATH: `/workspaces/claude-code-flow/node_modules/.bin:${process.env.PATH}` }
    });

    // Read and verify new content
    const content = await fs.readFile(settingsLocalPath, 'utf8');
    const settings = JSON.parse(content);

    // Should have default MCP permissions, not custom ones
    expect(settings.permissions.allow).toContain('mcp__ruv-swarm');
    expect(settings.permissions.allow).toContain('mcp__claude-flow');
    expect(settings.permissions.allow).not.toContain('custom-tool');
    expect(settings.permissions.deny).toEqual([]);
  });

  it('should create valid JSON format', async () => {
    // Run init command
    execSync('npx claude-flow init', {
      cwd: testDir,
      stdio: 'pipe',
      env: { ...process.env, PATH: `/workspaces/claude-code-flow/node_modules/.bin:${process.env.PATH}` }
    });

    const settingsLocalPath = path.join(testDir, '.claude', 'settings.local.json');
    const content = await fs.readFile(settingsLocalPath, 'utf8');

    // Should not throw when parsing
    expect(() => JSON.parse(content)).not.toThrow();

    // Check formatting (2-space indentation)
    expect(content).toMatch(/^{\n  "permissions": {\n    "allow": \[/);
  });
});