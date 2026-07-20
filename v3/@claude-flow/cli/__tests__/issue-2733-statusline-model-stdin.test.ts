/**
 * Regression test for issue #2733: `hooks statusline` hardcoded modelName to
 * 'Opus 4.6 (1M context)' regardless of stdin/actual model. After the fix,
 * readStatuslineModelFromStdin() reads `model.display_name` from the JSON
 * payload Claude Code pipes via stdin, falling back to 'Claude Code'.
 *
 * @see https://github.com/ruvnet/ruflo/issues/2733
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadSync, mockIsTTY } = vi.hoisted(() => ({
  mockReadSync: vi.fn(),
  mockIsTTY: { value: false },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readSync: mockReadSync };
});

Object.defineProperty(process.stdin, 'isTTY', {
  get: () => mockIsTTY.value,
  configurable: true,
});

const { readStatuslineModelFromStdin, _resetStdinModelCache } =
  await import('../src/commands/hooks.js');

/** Helper: make readSync return the given string payload then EOF on next call. */
function feedStdin(payload: string): void {
  const payloadBuf = Buffer.from(payload);
  mockReadSync.mockImplementationOnce((_fd: number, buf: Buffer) => {
    payloadBuf.copy(buf, 0, 0, payloadBuf.length);
    return payloadBuf.length;
  });
  mockReadSync.mockImplementationOnce(() => 0); // EOF
}

describe('readStatuslineModelFromStdin — issue #2733', () => {
  beforeEach(() => {
    _resetStdinModelCache();
    mockReadSync.mockReset();
    mockIsTTY.value = false;
  });

  it('returns the model display_name from stdin JSON payload', () => {
    feedStdin(JSON.stringify({ model: { display_name: 'Sonnet 4.5' } }));
    expect(readStatuslineModelFromStdin()).toBe('Sonnet 4.5');
  });

  it('returns null when stdin is a TTY (manual terminal, no piped data)', () => {
    mockIsTTY.value = true;
    expect(readStatuslineModelFromStdin()).toBeNull();
  });

  it('returns null when stdin has no model.display_name field', () => {
    feedStdin(JSON.stringify({ other_field: 'value' }));
    expect(readStatuslineModelFromStdin()).toBeNull();
  });

  it('returns null when stdin is not valid JSON', () => {
    feedStdin('not json at all');
    expect(readStatuslineModelFromStdin()).toBeNull();
  });

  it('returns null when stdin is empty (EOF immediately)', () => {
    mockReadSync.mockImplementationOnce(() => 0);
    expect(readStatuslineModelFromStdin()).toBeNull();
  });

  it('caches the result — second call does not read stdin again', () => {
    feedStdin(JSON.stringify({ model: { display_name: 'Haiku 3.5' } }));
    expect(readStatuslineModelFromStdin()).toBe('Haiku 3.5');
    // Second call should return cached value without new readSync calls
    const callCountAfterFirst = mockReadSync.mock.calls.length;
    expect(readStatuslineModelFromStdin()).toBe('Haiku 3.5');
    expect(mockReadSync.mock.calls.length).toBe(callCountAfterFirst);
  });
});
