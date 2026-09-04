import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('CLI smoke tests', () => {
  it('should show version', () => {
    const output = execSync('npx @claude-flow/cli@latest --version', {
      encoding: 'utf-8',
      timeout: 30000,
    }).trim();
    expect(output).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should show help', () => {
    const output = execSync('npx @claude-flow/cli@latest --help', {
      encoding: 'utf-8',
      timeout: 30000,
    }).trim();
    expect(output).toContain('claude-flow');
  });
});

describe('MCP tool surface', () => {
  it('should have memory tools registered', () => {
    const output = execSync('npx @claude-flow/cli@latest memory --help', {
      encoding: 'utf-8',
      timeout: 30000,
    }).trim();
    expect(output).toContain('store');
    expect(output).toContain('search');
  });
});

describe('Security eval', () => {
  it('should not contain hardcoded secrets in source', () => {
    const result = execSync(
      'grep -rn "AKIA\\|sk-[a-zA-Z0-9]\\{20,\\}\\|password\\s*=\\s*[\"\\x27][^\"\\x27]\\{8,\\}" src/ || true',
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    expect(result).toBe('');
  });
});
