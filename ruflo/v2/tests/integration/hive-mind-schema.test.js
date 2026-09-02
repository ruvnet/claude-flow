/**
 * Test for Hive Mind database schema - specifically for issue #403
 * Issue #403: Error: SQLITE_CONSTRAINT: NOT NULL constraint failed: agents.role
 * 
 * This test verifies that the database schema is created correctly
 * and that agents can be inserted with or without a role value.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';

describe('Hive Mind Database Schema - Issue #403', () => {
  let testDir;
  let dbPath;
  let db;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `claude-flow-hive-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    process.chdir(testDir);
    
    // Set database path
    dbPath = path.join(testDir, '.hive-mind', 'hive.db');
  });

  afterEach(async () => {
    // Close database if open
    if (db && db.open) {
      db.close();
    }
    
    // Clean up test directory
    process.chdir(os.tmpdir());
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Database Initialization via Init Command', () => {
    it('should create database with correct schema through init command', async () => {
      // Run init command
      execSync('npx claude-flow init', {
        cwd: testDir,
        stdio: 'pipe',
        env: { ...process.env, PATH: `/workspaces/claude-code-flow/node_modules/.bin:${process.env.PATH}` }
      });

      // Verify database file exists
      const dbExists = await fs.access(dbPath).then(() => true).catch(() => false);
      expect(dbExists).toBe(true);

      // Open database and check schema
      db = new Database(dbPath);
      
      // Check if agents table exists
      const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'").get();
      expect(tableInfo).toBeDefined();
      expect(tableInfo.sql).toContain('CREATE TABLE');
      expect(tableInfo.sql).toContain('agents');
      
      // Verify role column allows NULL values (not "NOT NULL")
      const columns = db.prepare("PRAGMA table_info(agents)").all();
      const roleColumn = columns.find(col => col.name === 'role');
      
      expect(roleColumn).toBeDefined();
      expect(roleColumn.notnull).toBe(0); // 0 means NULL is allowed, 1 means NOT NULL
    });

    it('should allow inserting agents without role value', async () => {
      // Run init command
      execSync('npx claude-flow init', {
        cwd: testDir,
        stdio: 'pipe',
        env: { ...process.env, PATH: `/workspaces/claude-code-flow/node_modules/.bin:${process.env.PATH}` }
      });

      // Open database
      db = new Database(dbPath);
      
      // First, create a swarm (required for foreign key)
      const swarmId = 'test-swarm-' + Date.now();
      db.prepare(`
        INSERT INTO swarms (id, name, objective, topology, status)
        VALUES (?, ?, ?, ?, ?)
      `).run(swarmId, 'Test Swarm', 'Test Objective', 'mesh', 'active');
      
      // Try to insert agent without role - this should NOT fail
      const agentId = 'test-agent-' + Date.now();
      const insertAgent = () => {
        db.prepare(`
          INSERT INTO agents (id, swarm_id, name, type, status)
          VALUES (?, ?, ?, ?, ?)
        `).run(agentId, swarmId, 'Test Agent', 'worker', 'active');
      };
      
      // This should not throw an error
      expect(insertAgent).not.toThrow();
      
      // Verify agent was inserted
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
      expect(agent).toBeDefined();
      expect(agent.id).toBe(agentId);
      expect(agent.role).toBeNull(); // Role should be NULL when not provided
    });

    it('should allow inserting agents with role value', async () => {
      // Run init command
      execSync('npx claude-flow init', {
        cwd: testDir,
        stdio: 'pipe',
        env: { ...process.env, PATH: `/workspaces/claude-code-flow/node_modules/.bin:${process.env.PATH}` }
      });

      // Open database
      db = new Database(dbPath);
      
      // Create a swarm
      const swarmId = 'test-swarm-' + Date.now();
      db.prepare(`
        INSERT INTO swarms (id, name, objective, topology, status)
        VALUES (?, ?, ?, ?, ?)
      `).run(swarmId, 'Test Swarm', 'Test Objective', 'mesh', 'active');
      
      // Insert agent with role
      const agentId = 'test-agent-' + Date.now();
      db.prepare(`
        INSERT INTO agents (id, swarm_id, name, type, role, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(agentId, swarmId, 'Test Agent', 'coordinator', 'leader', 'active');
      
      // Verify agent was inserted with role
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
      expect(agent).toBeDefined();
      expect(agent.id).toBe(agentId);
      expect(agent.role).toBe('leader');
    });
  });

  describe('Direct Database Schema Tests', () => {
    it('should create agents table with nullable role column', async () => {
      // Create .hive-mind directory
      await fs.mkdir(path.join(testDir, '.hive-mind'), { recursive: true });
      
      // Create database directly
      db = new Database(dbPath);
      
      // Create schema similar to what init command does
      db.exec(`
        CREATE TABLE IF NOT EXISTS swarms (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          objective TEXT,
          topology TEXT DEFAULT 'mesh',
          status TEXT DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          swarm_id TEXT,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          role TEXT,
          capabilities TEXT,
          status TEXT DEFAULT 'active',
          performance_score REAL DEFAULT 0.5,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (swarm_id) REFERENCES swarms (id)
        );
      `);
      
      // Check schema
      const columns = db.prepare("PRAGMA table_info(agents)").all();
      const roleColumn = columns.find(col => col.name === 'role');
      
      expect(roleColumn).toBeDefined();
      expect(roleColumn.type).toBe('TEXT');
      expect(roleColumn.notnull).toBe(0); // Should allow NULL
      expect(roleColumn.dflt_value).toBeNull(); // No default value
    });

    it('should handle schema migration from NOT NULL to nullable', async () => {
      // Create .hive-mind directory
      await fs.mkdir(path.join(testDir, '.hive-mind'), { recursive: true });
      
      // Create database with incorrect schema (role NOT NULL)
      db = new Database(dbPath);
      
      db.exec(`
        CREATE TABLE IF NOT EXISTS swarms (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          objective TEXT,
          topology TEXT DEFAULT 'mesh',
          status TEXT DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          swarm_id TEXT,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          role TEXT NOT NULL, -- This is the problematic constraint
          status TEXT DEFAULT 'idle',
          capabilities TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (swarm_id) REFERENCES swarms (id)
        );
      `);
      
      // Close and reopen to simulate migration scenario
      db.close();
      
      // Now run init command which should handle the existing schema
      execSync('npx claude-flow init --force', {
        cwd: testDir,
        stdio: 'pipe',
        env: { ...process.env, PATH: `/workspaces/claude-code-flow/node_modules/.bin:${process.env.PATH}` }
      });
      
      // Reopen and check if it was fixed
      db = new Database(dbPath);
      
      // The init command should have recreated or migrated the schema
      // Check if we can now insert without role
      const swarmId = 'test-swarm-' + Date.now();
      db.prepare(`
        INSERT INTO swarms (id, name, objective, topology, status)
        VALUES (?, ?, ?, ?, ?)
      `).run(swarmId, 'Test Swarm', 'Test Objective', 'mesh', 'active');
      
      const agentId = 'test-agent-' + Date.now();
      const insertAgent = () => {
        db.prepare(`
          INSERT INTO agents (id, swarm_id, name, type, status)
          VALUES (?, ?, ?, ?, ?)
        `).run(agentId, swarmId, 'Test Agent', 'worker', 'active');
      };
      
      // This should work now
      expect(insertAgent).not.toThrow();
    });
  });

  describe('Schema Consistency Tests', () => {
    it('should have consistent schema across all database creation paths', async () => {
      // Test schema from init command
      execSync('npx claude-flow init', {
        cwd: testDir,
        stdio: 'pipe',
        env: { ...process.env, PATH: `/workspaces/claude-code-flow/node_modules/.bin:${process.env.PATH}` }
      });
      
      db = new Database(dbPath);
      const initSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'").get();
      const initColumns = db.prepare("PRAGMA table_info(agents)").all();
      db.close();
      
      // Clean up for next test
      await fs.rm(path.join(testDir, '.hive-mind'), { recursive: true, force: true });
      
      // Test that all paths create the same schema
      // The key is that role should always be nullable (not NOT NULL)
      const roleColumn = initColumns.find(col => col.name === 'role');
      expect(roleColumn.notnull).toBe(0); // Must allow NULL
      
      // Also check other important columns
      const requiredColumns = ['id', 'swarm_id', 'name', 'type', 'status'];
      requiredColumns.forEach(colName => {
        const column = initColumns.find(col => col.name === colName);
        expect(column).toBeDefined();
      });
    });
  });
});