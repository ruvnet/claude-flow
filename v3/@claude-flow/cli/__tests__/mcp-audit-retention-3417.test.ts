import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { appendAuditLog, evaluateToolCall, getAuditLogPath, resetPolicyEnforcerState, setAuditLogPathForTesting } from '../src/mcp-tools/policy-enforcer.js';

let project: string;
const entry = (id: number) => ({ timestamp: '2026-09-26T00:00:00.000Z', sessionId: 's', toolName: `tool_${id}`, allowed: true });
const records = (file: string) => fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ruflo-audit-retention-'));
  vi.spyOn(process, 'cwd').mockReturnValue(project);
  // Isolate the legacy tmpdir destination as well when running the negative control.
  vi.stubEnv('TMPDIR', project);
  vi.stubEnv('TMP', project);
  vi.stubEnv('TEMP', project);
  vi.stubEnv('RUFLO_MCP_AUDIT_LOG_PATH', '');
  setAuditLogPathForTesting(null);
  resetPolicyEnforcerState();
});
afterEach(() => {
  setAuditLogPathForTesting(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(project, { recursive: true, force: true });
});

describe('project audit retention (#3417)', () => {
  it('isolates default logs by project instead of using a global temporary file', () => {
    const first = getAuditLogPath();
    expect(first).toBe(path.join(project, '.claude-flow/logs/mcp-audit.jsonl'));
    vi.mocked(process.cwd).mockReturnValue(path.join(project, 'second'));
    expect(getAuditLogPath()).not.toBe(first);
  });
  it.each(['audit/events.jsonl', '/explicit/audit/events.jsonl'])('resolves a deployment path: %s', configured => {
    vi.stubEnv('RUFLO_MCP_AUDIT_LOG_PATH', configured);
    expect(getAuditLogPath()).toBe(path.resolve(project, configured));
  });
  it.each(['policy/events.jsonl', path.join(os.tmpdir(), 'explicit-policy/events.jsonl')])('gives the explicit policy path precedence over the environment: %s', auditLogPath => {
    vi.stubEnv('RUFLO_MCP_AUDIT_LOG_PATH', 'env/events.jsonl');
    expect(getAuditLogPath({ auditLogPath })).toBe(path.resolve(project, auditLogPath));
  });
  it('writes mandatory audit evidence to the explicit policy destination', () => {
    vi.stubEnv('RUFLO_MCP_AUDIT_LOG_PATH', 'env/events.jsonl');
    const policy = { auditLog: true, auditLogPath: 'policy/events.jsonl' };
    expect(evaluateToolCall(policy, 's', 'tool').allowed).toBe(true);
    expect(records(path.join(project, policy.auditLogPath))[0]).toMatchObject({ toolName: 'tool', allowed: true });
    expect(fs.existsSync(path.join(project, 'env'))).toBe(false);
    expect(fs.existsSync(path.join(project, '.claude-flow'))).toBe(false);
  });
  it.each(['', '   ', null, 42])('fails closed for an invalid explicit audit path: %s', auditLogPath => {
    vi.stubEnv('RUFLO_MCP_AUDIT_LOG_PATH', 'env/events.jsonl');
    expect(evaluateToolCall({ auditLog: true, auditLogPath: auditLogPath as string }, 's', 'tool').allowed).toBe(false);
    expect(fs.readdirSync(project)).toEqual([]);
  });
  it('creates the configured parent and records the project with private permissions', () => {
    vi.stubEnv('RUFLO_MCP_AUDIT_LOG_PATH', 'custom/events.jsonl');
    expect(appendAuditLog({ auditLog: true }, entry(1))).toBe(true);
    const file = getAuditLogPath();
    expect(records(file)[0]).toMatchObject({ ...entry(1), projectPath: project });
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
  it('rotates before exceeding the byte bound and retains only the configured backups', () => {
    const bytes = Buffer.byteLength(JSON.stringify({ ...entry(1), projectPath: project }) + '\n');
    const policy = { auditLog: true, auditLogMaxBytes: bytes + 1, auditLogMaxFiles: 2 };
    for (let i = 1; i <= 6; i++) expect(appendAuditLog(policy, entry(i))).toBe(true);
    const file = getAuditLogPath();
    expect(records(file)[0].toolName).toBe('tool_6');
    expect(records(`${file}.1`)[0].toolName).toBe('tool_5');
    expect(records(`${file}.2`)[0].toolName).toBe('tool_4');
    expect(fs.existsSync(`${file}.3`)).toBe(false);
    for (const candidate of [file, `${file}.1`, `${file}.2`]) expect(fs.statSync(candidate).size).toBeLessThanOrEqual(policy.auditLogMaxBytes);
  });
  it.each([{ auditLogMaxBytes: 0 }, { auditLogMaxBytes: 1.5 }, { auditLogMaxFiles: -1 }, { auditLogMaxFiles: 101 }])('fails closed for invalid retention settings %o', invalid => {
    expect(evaluateToolCall({ auditLog: true, ...invalid }, 's', 'tool').allowed).toBe(false);
  });
  it('denies an oversized record without deleting previous audit evidence', () => {
    expect(appendAuditLog({ auditLog: true }, entry(1))).toBe(true);
    const before = fs.readFileSync(getAuditLogPath());
    expect(evaluateToolCall({ auditLog: true, auditLogMaxBytes: 1 }, 's', 'tool').allowed).toBe(false);
    expect(fs.readFileSync(getAuditLogPath())).toEqual(before);
  });
  it('fails closed on lock contention without removing the other writer lock', () => {
    expect(appendAuditLog({ auditLog: true }, entry(1))).toBe(true);
    const file = getAuditLogPath();
    fs.writeFileSync(`${file}.lock`, 'other writer');
    const before = fs.readFileSync(file);
    expect(evaluateToolCall({ auditLog: true }, 's', 'tool').allowed).toBe(false);
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readFileSync(`${file}.lock`, 'utf8')).toBe('other writer');
  });
  it('preserves evidence and releases its lock after a rotation failure', () => {
    expect(appendAuditLog({ auditLog: true }, entry(1))).toBe(true);
    const file = getAuditLogPath();
    const before = fs.readFileSync(file);
    fs.mkdirSync(`${file}.1`);
    expect(evaluateToolCall({ auditLog: true, auditLogMaxBytes: before.length + 1 }, 's', 'tool').allowed).toBe(false);
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
    fs.rmdirSync(`${file}.1`);
    expect(appendAuditLog({ auditLog: true }, entry(2))).toBe(true);
  });
  it('does no filesystem work when auditing is disabled', () => {
    expect(appendAuditLog({ auditLog: false, auditLogMaxBytes: -1 }, entry(1))).toBe(true);
    expect(fs.readdirSync(project)).toEqual([]);
  });
});
