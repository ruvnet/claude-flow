import { MAX_LINE, openSession } from './files.js';
import { ActivityParser } from './parser.js';
import type { ActivitySnapshot, SessionIdentity } from './types.js';

const READ_BUDGET = 1024 * 1024;

/** Incremental reads keep UI refreshes bounded even when a helper inherits a large log. */
export class ActivityReader {
  private parser: ActivityParser;
  private offset = 0;
  private signature = '';
  private mtime = 0;
  private head = Buffer.alloc(0);
  private anchor = Buffer.alloc(0);
  private pending = Buffer.alloc(0);
  private skipping = false;

  constructor(private readonly root: string, private readonly identity: SessionIdentity,
    private readonly budget = READ_BUDGET) {
    this.parser = new ActivityParser(identity.id, identity.path);
  }

  private reset(): void {
    this.parser = new ActivityParser(this.identity.id, this.identity.path);
    this.offset = 0;
    this.pending = Buffer.alloc(0);
    this.skipping = false;
    this.head = Buffer.alloc(0);
    this.anchor = Buffer.alloc(0);
  }

  async read(): Promise<ActivitySnapshot> {
    try {
      const handle = await openSession(this.root, this.identity.file);
      try {
        const stat = await handle.stat();
        const signature = `${stat.dev}:${stat.ino}`;
        const unchanged = async (expected: Buffer, position: number): Promise<boolean> => {
          const buffer = Buffer.alloc(expected.length);
          await handle.read(buffer, 0, buffer.length, position);
          return buffer.equals(expected);
        };
        if (signature !== this.signature || stat.size < this.offset
          || (this.mtime !== stat.mtimeMs && stat.size === this.offset)
          || !await unchanged(this.head, 0)
          || !await unchanged(this.anchor, Math.max(0, this.offset - this.anchor.length))) this.reset();
        this.signature = signature;
        this.mtime = stat.mtimeMs;
        const buffer = Buffer.alloc(Math.min(this.budget, Math.max(0, stat.size - this.offset)));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
        const data = buffer.subarray(0, bytesRead);
        this.offset += bytesRead;
        this.feed(data);
        this.head = Buffer.alloc(Math.min(256, this.offset));
        await handle.read(this.head, 0, this.head.length, 0);
        this.anchor = Buffer.alloc(Math.min(128, this.offset));
        await handle.read(this.anchor, 0, this.anchor.length, this.offset - this.anchor.length);
        const state = this.parser.snapshot;
        state.bytesRead = this.offset;
        state.fileSize = stat.size;
        state.partial = this.offset < stat.size || this.pending.length > 0 || this.skipping;
        // Do not expose stale previews after an identity failure.
        return structuredClone(state);
      } finally { await handle.close(); }
    } catch {
      this.reset();
      this.signature = '';
      return { ...this.parser.snapshot, error: 'Agent log unavailable; no cached activity is shown.' };
    }
  }

  private feed(data: Buffer): void {
    let start = 0;
    while (start < data.length) {
      const newline = data.indexOf(10, start);
      const end = newline < 0 ? data.length : newline;
      const part = data.subarray(start, end);
      if (!this.skipping) {
        if (this.pending.length + part.length > MAX_LINE) {
          this.pending = Buffer.alloc(0);
          this.skipping = true;
          this.parser.invalidate();
        } else this.pending = Buffer.concat([this.pending, part]);
      }
      if (newline < 0) break;
      if (!this.skipping) {
        try { this.parser.consume(JSON.parse(this.pending.toString('utf8'))); }
        catch { this.parser.invalidate(); }
      }
      this.pending = Buffer.alloc(0);
      this.skipping = false;
      start = newline + 1;
    }
  }
}
