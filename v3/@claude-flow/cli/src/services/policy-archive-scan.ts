/** Fixed-chunk reverse archive scan used by the synchronous anchor gate.
 * Memory follows the largest single line, never the entire archive/window.
 */
import { readSync } from 'node:fs';
const CHUNK_BYTES = 64 * 1024;
export interface ReverseRecord { bytes: Buffer; offset: number; terminated: boolean }
export function* reverseArchiveRecords(fd: number, size: number, limit: number): Generator<ReverseRecord> {
  let position = size;
  let parts: Buffer[] = [];
  let partBytes = 0;
  let terminated = false;
  while (position > 0) {
    const count = Math.min(CHUNK_BYTES, position);
    position -= count;
    const chunk = Buffer.allocUnsafe(count);
    let read = 0;
    while (read < count) {
      const next = readSync(fd, chunk, read, count - read, position + read);
      if (!next) throw new Error('policy-ledger-archive-changed'); read += next;
    }
    let end = chunk.length;
    for (;;) {
      const newline = chunk.lastIndexOf(10, end - 1);
      if (newline < 0) break;
      const piece = chunk.subarray(newline + 1, end);
      if (piece.length + partBytes > limit) throw new Error(`policy-ledger-archive-record-too-large:${limit}`);
      const bytes = parts.length ? Buffer.concat([piece, ...parts], piece.length + partBytes) : Buffer.from(piece);
      yield { bytes, offset: position + newline + 1, terminated };
      terminated = true;
      parts = []; partBytes = 0; end = newline;
      if (end === 0) break;
    }
    if (end > 0) {
      if (partBytes + end > limit) throw new Error(`policy-ledger-archive-record-too-large:${limit}`);
      const piece = Buffer.from(chunk.subarray(0, end)); parts.unshift(piece); partBytes += piece.length;
    }
  }
  if (partBytes > 0) yield { bytes: Buffer.concat(parts, partBytes), offset: 0, terminated };
}
