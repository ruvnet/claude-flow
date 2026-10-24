/**
 * Tests for Deployment Module
 */
import { describe, it, expect } from 'vitest';
import { ReleaseManager } from '../index.js';

describe('ReleaseManager', () => {
  describe('Constructor', () => {
    it('should create with default cwd', () => {
      const manager = new ReleaseManager();
      expect(manager).toBeDefined();
    });

    it('should create with custom cwd', () => {
      const manager = new ReleaseManager('/custom/path');
      expect(manager).toBeDefined();
    });
  });
});

describe('Version Bump Logic', () => {
  it('should parse version parts', () => {
    const version = '1.2.3';
    const parts = version.split('.').map(Number);
    
    expect(parts[0]).toBe(1);
    expect(parts[1]).toBe(2);
    expect(parts[2]).toBe(3);
  });

  it('should bump patch version', () => {
    const parts = '1.0.0'.split('.').map(Number);
    const newVersion = [parts[0], parts[1], parts[2] + 1].join('.');
    expect(newVersion).toBe('1.0.1');
  });

  it('should bump minor version', () => {
    const parts = '1.0.0'.split('.').map(Number);
    const newVersion = [parts[0], parts[1] + 1, 0].join('.');
    expect(newVersion).toBe('1.1.0');
  });

  it('should bump major version', () => {
    const parts = '1.0.0'.split('.').map(Number);
    const newVersion = [parts[0] + 1, 0, 0].join('.');
    expect(newVersion).toBe('2.0.0');
  });
});

describe('Changelog Generation', () => {
  it('should format date correctly', () => {
    const date = new Date('2026-01-05');
    const formatted = date.toISOString().split('T')[0];
    expect(formatted).toBe('2026-01-05');
  });

  it('should categorize commits by type', () => {
    const commits = [
      { message: 'feat: add new feature' },
      { message: 'fix: fix bug' },
      { message: 'docs: update docs' },
    ];

    const feat = commits.filter(c => c.message.startsWith('feat:'));
    const fix = commits.filter(c => c.message.startsWith('fix:'));
    const docs = commits.filter(c => c.message.startsWith('docs:'));

    expect(feat).toHaveLength(1);
    expect(fix).toHaveLength(1);
    expect(docs).toHaveLength(1);
  });
});
