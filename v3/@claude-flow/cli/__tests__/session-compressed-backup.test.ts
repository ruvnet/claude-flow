import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { sessionCommand } from '../src/commands/session.js';
import { callMCPTool } from '../src/mcp-client.js';

interface SavedSession { sessionId: string }
interface SessionSnapshot { data: { name: string; description?: string } }

const action = (name: string) => {
  const handler = sessionCommand.subcommands?.find(command => command.name === name)?.action;
  if (!handler) throw new Error(`session ${name} action is unavailable`);
  return handler;
};

const save = () => callMCPTool<SavedSession>('session_save', {
  name: 'checkpoint', description: 'Unicode résumé 🐢',
  includeMemory: false, includeTasks: false, includeAgents: false,
});

describe('compressed session backups through the public command and tools', () => {
  let root: string;
  let previous: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ruflo-session-gzip-'));
    previous = process.cwd();
    process.chdir(root);
  });
  afterEach(() => { process.chdir(previous); rmSync(root, { recursive: true, force: true }); });

  it.each([undefined, 'named-backup.bin'])('writes real gzip bytes with output %s', async (file) => {
    const saved = await save();
    const snapshot = await callMCPTool<SessionSnapshot>('session_export', { sessionId: saved.sessionId });
    const result = await action('export')({
      args: [saved.sessionId], flags: { _: [], format: 'json', compress: true, ...(file ? { output: file } : {}) },
      cwd: root, interactive: false,
    });
    expect(result?.success).toBe(true);
    const bytes = readFileSync(join(root, file ?? `session-${saved.sessionId}.json.gz`));
    expect(bytes.subarray(0, 2).toString('hex')).toBe('1f8b');
    expect(JSON.parse(gunzipSync(bytes).toString('utf8'))).toEqual(snapshot.data);
    expect(result?.data).toMatchObject({ size: bytes.length });
  });

  it('round-trips a compressed JSON export through session import', async () => {
    const saved = await save();
    const snapshot = await callMCPTool<SessionSnapshot>('session_export', { sessionId: saved.sessionId });
    await action('export')({ args: [saved.sessionId], flags: { _: [], format: 'json', output: 'backup.json.gz', compress: true }, cwd: root, interactive: false });
    const imported = await action('import')({ args: ['backup.json.gz'], flags: { _: [] }, cwd: root, interactive: false });
    expect(imported?.success).toBe(true);
    const id = (imported?.data as SavedSession).sessionId;
    expect(id).not.toBe(saved.sessionId);
    const restored = await callMCPTool<SessionSnapshot>('session_export', { sessionId: id });
    expect(restored.data.name).toBe(snapshot.data.name);
    expect(restored.data.description).toBe(snapshot.data.description);
  });

  it('imports gzip JSON by magic bytes regardless of the filename', async () => {
    const saved = await save();
    const snapshot = await callMCPTool<SessionSnapshot>('session_export', { sessionId: saved.sessionId });
    writeFileSync('external-backup.bin', gzipSync(JSON.stringify(snapshot.data)));
    const imported = await callMCPTool<SavedSession & { error?: string }>('session_import', { inputPath: join(root, 'external-backup.bin') });
    expect(imported.error).toBeUndefined();
    const restored = await callMCPTool<SessionSnapshot>('session_export', { sessionId: imported.sessionId });
    expect(restored.data.name).toBe('checkpoint');
  });

  it('retains plain JSON and reports its actual UTF-8 byte count', async () => {
    const saved = await save();
    const result = await action('export')({ args: [saved.sessionId], flags: { _: [], format: 'json', output: 'plain.json', compress: false }, cwd: root, interactive: false });
    const bytes = readFileSync('plain.json');
    expect(JSON.parse(bytes.toString('utf8')).name).toBe('checkpoint');
    expect(result?.data).toMatchObject({ size: bytes.length });
    const imported = await action('import')({ args: ['plain.json'], flags: { _: [] }, cwd: root, interactive: false });
    expect(imported?.success).toBe(true);
  });

  it('continues to reject display-only YAML backups', async () => {
    writeFileSync('backup.yaml.gz', gzipSync('name: checkpoint\nsessionId: example\n'));
    const result = await action('import')({ args: ['backup.yaml.gz'], flags: { _: [] }, cwd: root, interactive: false });
    expect(result).toMatchObject({ success: false, exitCode: 1 });
  });
});
