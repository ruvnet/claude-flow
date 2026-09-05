/**
 * Regression guard for issue #2594 — `memory store → memory delete → memory store`
 * on the same (namespace, key) crashed with `UNIQUE constraint failed:
 * memory_entries.namespace, memory_entries.key`.
 *
 * Root cause: `memory delete` is a soft delete (sets status='deleted', row
 * remains), the schema's `UNIQUE(namespace, key)` constraint does NOT exclude
 * deleted rows, and the CLI's `memory store` command previously defaulted
 * `--upsert` to `false` — so the second store issued a plain INSERT that
 * collided with the soft-deleted row.
 *
 * Fix (c36cb4d66): flip the CLI-surface default to `--upsert=true` so
 * store→delete→store just works. Users who want strict insert semantics pass
 * `--no-upsert`.
 *
 * This guard is a pure static assertion on the command definition — it fails
 * the moment someone flips the default back to `false`.
 */
import { describe, it, expect } from 'vitest';
import { memoryCommand } from '../src/commands/memory.js';

describe('memory store --upsert default (#2594)', () => {
  const storeCmd = memoryCommand.subcommands?.find(c => c.name === 'store');
  const upsertOpt = storeCmd?.options?.find(o => o.name === 'upsert');

  it('exposes the `store` subcommand with an `upsert` option', () => {
    expect(storeCmd).toBeDefined();
    expect(upsertOpt).toBeDefined();
    expect(upsertOpt?.type).toBe('boolean');
  });

  it('defaults --upsert to true so store→delete→store does not hit UNIQUE(namespace,key)', () => {
    // If this flips back to `false` (or `undefined`), issue #2594 reopens: any
    // `store → delete → store` on the same (namespace, key) will crash with
    // `UNIQUE constraint failed: memory_entries.namespace, memory_entries.key`
    // because the soft-deleted row still occupies the unique slot.
    expect(upsertOpt?.default).toBe(true);
  });
});
