import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonMemoryBackend } from '../src/memory/json-backend.js';

describe('JsonMemoryBackend TTL behavior', () => {
  let dir: string;
  let backend: JsonMemoryBackend;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'json-backend-ttl-'));
    backend = new JsonMemoryBackend({ path: join(dir, 'memory.json') });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('immediately treats an entry stored with ttl: 0 as expired on read while entry with no ttl is not', async () => {
    await backend.store('expires-immediately', 'val1', { ttl: 0 });
    await backend.store('lives-forever', 'val2');

    expect(await backend.retrieve('expires-immediately')).toBeNull();
    const retained = await backend.retrieve('lives-forever');
    expect(retained).not.toBeNull();
    expect(retained?.value).toBe('val2');

    const listed = await backend.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].key).toBe('lives-forever');
  });
});
