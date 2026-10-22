import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listSessions, readIdentity, MAX_LINE } from '../src/activity/files.js';
import { ActivityReader } from '../src/activity/reader.js';
import { fixture, jsonl, message, meta, own, record } from './activity-fixtures.js';

let files: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { files = await fixture(); });
afterEach(async () => { await rm(files.directory, { recursive: true, force: true }); });

describe('session discovery', () => {
  it('accepts a complete metadata line ending at the prefix boundary', async () => {
    const header = JSON.stringify(meta()).padEnd(MAX_LINE - 1, ' ');
    await writeFile(files.helper, header + '\n');
    expect(await readIdentity(files.directory, files.helper)).toMatchObject({ id: 'helper' });
  });
  it.each([MAX_LINE, MAX_LINE + 1])('rejects a %i-byte metadata line even with a valid JSON prefix', async (size) => {
    const header = JSON.stringify(meta('HEADER_SENTINEL')).padEnd(size, ' ');
    expect(() => JSON.parse(header.slice(0, MAX_LINE))).not.toThrow();
    await writeFile(files.helper, header + '\n' + jsonl([own(), message('ACTIVITY_SENTINEL')]));
    expect(await readIdentity(files.directory, files.helper)).toBeNull();
    const listed = await listSessions(files.directory, files.parent);
    expect(listed.helpers).toEqual([]);
    expect(JSON.stringify(listed)).not.toMatch(/HEADER_SENTINEL|ACTIVITY_SENTINEL/);
  });
  it('rejects oversized JSON metadata without exposing a truncated string', async () => {
    const header = JSON.stringify(record('session_meta', {
      id: 'root', source: 'cli', agent_nickname: 'HEADER_SENTINEL', padding: '界'.repeat(MAX_LINE),
    }));
    await writeFile(files.parent, header + '\n' + jsonl([message('ACTIVITY_SENTINEL')]));
    expect(await readIdentity(files.directory, files.parent)).toBeNull();
    const listed = await listSessions(files.directory, files.parent);
    expect(listed.root).toBeNull();
    expect(listed.helpers).toEqual([]);
    expect(JSON.stringify(listed)).not.toMatch(/HEADER_SENTINEL|ACTIVITY_SENTINEL/);
  });
  it('waits for the metadata newline before discovering a helper', async () => {
    await writeFile(files.helper, JSON.stringify(meta()));
    expect(await readIdentity(files.directory, files.helper)).toBeNull();
    await appendFile(files.helper, '\n');
    expect(await readIdentity(files.directory, files.helper)).toMatchObject({ id: 'helper' });
  });
  it('includes nested descendants across date folders and excludes unrelated/guardian logs', async () => {
    await writeFile(path.join(files.nested, 'nested.jsonl'), jsonl([meta('nested', 'helper')]));
    await writeFile(path.join(files.directory, 'other.jsonl'), jsonl([meta('other', 'unrelated')]));
    await writeFile(path.join(files.directory, 'guardian.jsonl'), jsonl([record('session_meta', {
      id: 'guardian', source: { subagent: 'guardian' }, parent_thread_id: 'root',
    })]));
    const result = await listSessions(files.directory, files.parent);
    expect(result.helpers.map(item => item.id).sort()).toEqual(['helper', 'nested']);
    expect(result.error).toBe('');
  });
  it('rejects duplicate identities rather than choosing a file', async () => {
    await writeFile(path.join(files.nested, 'copy.jsonl'), jsonl([meta()]));
    await writeFile(path.join(files.nested, 'child.jsonl'), jsonl([meta('child', 'helper')]));
    const result = await listSessions(files.directory, files.parent);
    expect(result.helpers).toEqual([]);
    expect(result.partial).toBe(true);
  });
  it('rejects a duplicate root identity', async () => {
    await writeFile(path.join(files.nested, 'copy.jsonl'), jsonl([meta('root', null)]));
    expect((await listSessions(files.directory, files.parent)).error).toContain('ambiguous');
  });
  it('does not treat a helper as a root or switch to a replacement root', async () => {
    expect((await listSessions(files.directory, files.helper)).error).toContain('root CLI');
    expect((await listSessions(files.directory, files.parent, 'different')).helpers).toEqual([]);
  });
  it('excludes cycles and unsupported metadata', async () => {
    await writeFile(path.join(files.nested, 'a.jsonl'), jsonl([meta('a', 'b')]));
    await writeFile(path.join(files.nested, 'b.jsonl'), jsonl([meta('b', 'a')]));
    await writeFile(path.join(files.nested, 'wrong.jsonl'), jsonl([record('event_msg', { id: 'wrong' })]));
    expect((await listSessions(files.directory, files.parent)).helpers.map(item => item.id)).toEqual(['helper']);
  });
  it('rejects outside paths and symlinked session files', async () => {
    await expect(readIdentity(files.nested, files.parent)).rejects.toThrow();
    const linked = path.join(files.directory, 'linked.jsonl');
    await symlink(files.helper, linked);
    await expect(readIdentity(files.directory, linked)).rejects.toThrow();
    expect((await listSessions(files.directory, files.parent)).helpers).toHaveLength(1);
  });
  it('does not recurse through linked directories', async () => {
    await symlink(files.directory, path.join(files.nested, 'loop'), 'junction');
    expect((await listSessions(files.directory, files.parent)).helpers).toHaveLength(1);
  });
  it('treats a deleted root as unavailable', async () => {
    await rm(files.parent);
    expect((await listSessions(files.directory, files.parent)).error).toContain('unavailable');
  });
});

async function reader(budget?: number) {
  const identity = await readIdentity(files.directory, files.helper);
  if (!identity) throw new Error('Invalid fixture');
  return new ActivityReader(files.directory, identity, budget);
}

describe('incremental activity reader', () => {
  it('exposes no activity when a discovered header becomes oversized', async () => {
    const view = await reader(MAX_LINE);
    expect((await view.read()).events.length).toBeGreaterThan(0);
    await writeFile(files.helper, JSON.stringify(meta()).padEnd(MAX_LINE + 1, ' ') + '\n' +
      jsonl([meta(), own(), message('ACTIVITY_SENTINEL', 'user'), message('ACTIVITY_SENTINEL')]));
    const prefix = await view.read();
    expect(prefix.partial).toBe(true);
    expect(prefix.available).toBe(false);
    expect(prefix.events).toEqual([]);
    const complete = await view.read();
    expect(complete.limited).toBe(true);
    expect(complete.available).toBe(false);
    expect(complete.assignment).toBe('');
    expect(complete.events).toEqual([]);
    expect(JSON.stringify(complete)).not.toContain('ACTIVITY_SENTINEL');
  });
  it('reads bounded chunks and joins split UTF-8 and JSON without showing partial records', async () => {
    await writeFile(files.helper, jsonl([meta(), own(), message('Hello 世界')]).trimEnd());
    const view = await reader(13);
    let result = await view.read();
    expect(result.bytesRead).toBe(13);
    for (let i = 0; i < 100 && result.bytesRead < result.fileSize; i++) result = await view.read();
    expect(result.events).toEqual([]);
    expect(result.partial).toBe(true);
    await appendFile(files.helper, '\n');
    result = await view.read();
    expect(result.events[0]?.text).toBe('Hello 世界');
    expect(result.partial).toBe(false);
  });
  it('resets after truncation and rejects replacement identity', async () => {
    const view = await reader();
    expect((await view.read()).events.length).toBeGreaterThan(0);
    await writeFile(files.helper, jsonl([meta('wrong'), own(), message('HIDDEN')]));
    const result = await view.read();
    expect(result.available).toBe(false);
    expect(result.events).toEqual([]);
  });
  it('resets after rename/replacement and does not retain old activity', async () => {
    const view = await reader();
    await view.read();
    await rename(files.helper, path.join(files.directory, 'old.txt'));
    await writeFile(files.helper, jsonl([meta(), own(), message('New file')]));
    expect((await view.read()).events.map(event => event.text)).toEqual(['New file']);
  });
  it('detects a truncate-and-regrow rewrite of the same inode', async () => {
    const view = await reader();
    await view.read();
    await writeFile(files.helper, jsonl([meta('wrong'), own(), message('HIDDEN'.repeat(500))]));
    expect((await view.read()).events).toEqual([]);
  });
  it('drops stale data on a read error and recovers when the file returns', async () => {
    const view = await reader();
    await view.read();
    await rm(files.helper);
    expect((await view.read()).events).toEqual([]);
    await writeFile(files.helper, jsonl([meta(), own(), message('Recovered')]));
    expect((await view.read()).events[0]?.text).toBe('Recovered');
  });
  it('skips oversized lines and closes attribution until a new own-thread record', async () => {
    await writeFile(files.helper, jsonl([meta(), own()]) + 'x'.repeat(MAX_LINE + 20) + '\n' +
      jsonl([message('HIDDEN'), own(), message('visible')]));
    const result = await (await reader()).read();
    expect(result.events.map(event => event.text)).toEqual(['visible']);
    expect(result.limited).toBe(true);
  });
  it('closes attribution on malformed complete lines', async () => {
    await writeFile(files.helper, jsonl([meta(), own()]) + '{bad}\n' + jsonl([message('HIDDEN'), own(), message('visible')]));
    expect((await (await reader()).read()).events.map(event => event.text)).toEqual(['visible']);
  });
  it('returns detached snapshots', async () => {
    const view = await reader();
    const first = await view.read();
    first.events.length = 0;
    expect((await view.read()).events.length).toBeGreaterThan(0);
  });
});
