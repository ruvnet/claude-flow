import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const helpers = [
  resolve(__dirname, '../.claude/helpers/intelligence.cjs'),
  resolve(__dirname, '../../../../.claude/helpers/intelligence.cjs'),
];

function recall(helper: string, prompt: string, entries: unknown[]): { surfaced: Array<{ id: string }> } | null {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-recall-4136-'));
  const data = join(root, '.claude-flow', 'data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'ranked-context.json'), JSON.stringify({ version: 1, entries }));
  try {
    const script = `process.stdout.write(JSON.stringify(require(${JSON.stringify(helper)}).getContextDetailed(${JSON.stringify(prompt)})))`;
    return JSON.parse(execFileSync(process.execPath, ['-e', script], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      encoding: 'utf8',
    }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const filler = Array.from({ length: 220 }, (_, i) => `background${i}`);
const entries = [
  { id: 'unrelated-hub', summary: 'HTTP 500 incident index', words: ['http', '500', 'server', 'incident', ...filler], pageRank: 0.6 },
  { id: 'postgrest-rpc', summary: 'PostgREST P0002 RPC mapping', words: ['postgrest', 'http', '500', 'p0002', 'rpc', 'error', ...filler], pageRank: 0.001 },
  { id: 'wrangler-token', summary: 'Wrangler token expiry', words: ['wrangler', 'token', 'expired', 'release', ...filler], pageRank: 0.001 },
];

describe.each(helpers)('route memory recall (%s)', (helper) => {
  it('surfaces the correct long entry ahead of a high-rank generic one', () => {
    const hit = recall(helper, 'why does PostgREST return HTTP 500 for P0002 from an RPC', entries);
    expect(hit?.surfaced[0]?.id).toBe('postgrest-rpc');
    expect(hit?.surfaced.map(e => e.id)).not.toContain('unrelated-hub');
  });

  it('returns no context when only graph rank is high', () => {
    expect(recall(helper, 'firebase JWT refresh rotation', entries)).toBeNull();
  });

  it('does not let two incidental words outweigh the unmatched query', () => {
    expect(recall(helper, 'firebase JWT refresh rotation HTTP 500', entries)).toBeNull();
  });

  it('matches inflected forms: migrations/migration, deploying/deploy', () => {
    const inflected = [
      ...entries,
      { id: 'migration-runner', summary: 'pgTAP migration runner', words: ['migration', 'runner', 'replays', 'file', 'deploy', ...filler], pageRank: 0.001 },
    ];
    const hit = recall(helper, 'the runner replays migrations while deploying', inflected);
    expect(hit?.surfaced[0]?.id).toBe('migration-runner');
  });

  it('does not stem short words into unrelated ones', () => {
    const shortEntries = [{ id: 'bus', summary: 'bus', words: ['bus', 'ran', ...filler], pageRank: 0.001 }];
    expect(recall(helper, 'running busy ranges', shortEntries)).toBeNull();
  });

  it('finds a different long entry on its own distinctive terms', () => {
    const hit = recall(helper, 'the wrangler token expired during release', entries);
    expect(hit?.surfaced[0]?.id).toBe('wrangler-token');
  });
});
