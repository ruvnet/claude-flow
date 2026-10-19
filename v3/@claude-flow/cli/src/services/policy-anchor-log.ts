/** Streaming reader/writer for the existing version-1 anchor JSON object.
 * Every entry is still parsed and authenticated by the caller. This bounds
 * memory without weakening historical validation or changing the log format.
 */
import { closeSync, constants, fstatSync, openSync, readSync, writeSync } from 'node:fs';
import { TextDecoder } from 'node:util';

export const ATOMIC_JSON_WRITER = Symbol('policy-atomic-json-writer');
export interface AtomicJsonSource { [ATOMIC_JSON_WRITER](fd: number): void }
const CHUNK_BYTES = 64 * 1024;
const VALUE_LIMIT = 16 * 1024 * 1024;
const STRING_STRUCTURE = /["\\]/g;
const VALUE_STRUCTURE = /["\\{}\[\]]/g;

class JsonReader {
  private readonly fd: number;
  private readonly buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private text = '';
  private cursor = 0;
  private position = 0;
  private ended = false;
  constructor(file: string) {
    this.fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try { if (!fstatSync(this.fd).isFile()) throw new Error('policy-anchor-log-corrupt'); }
    catch (error) { closeSync(this.fd); throw error; }
  }
  close(): void { closeSync(this.fd); }
  peek(): string {
    while (this.cursor >= this.text.length && !this.ended) {
      const count = readSync(this.fd, this.buffer, 0, this.buffer.length, this.position);
      this.position += count;
      this.text = this.decoder.decode(this.buffer.subarray(0, count), { stream: count !== 0 });
      this.cursor = 0;
      if (!count) this.ended = true;
    }
    return this.text[this.cursor] ?? '';
  }
  next(): string { const character = this.peek(); if (character) this.cursor++; return character; }
  whitespace(): void { while (/[ \t\r\n]/.test(this.peek()) && this.peek()) this.next(); }
  expect(character: string): void { this.whitespace(); if (this.next() !== character) throw new Error('policy-anchor-log-corrupt'); }
  value(): unknown {
    this.whitespace(); const first = this.peek();
    if (!first) throw new Error('policy-anchor-log-corrupt');
    const compound = first === '{' || first === '[';
    const string = first === '"';
    const parts: string[] = [];
    let bytes = 0; let depth = 0; let quoted = false; let escaped = false;
    for (;;) {
      if (!this.peek()) {
        if (quoted || depth !== 0 || !parts.length) throw new Error('policy-anchor-log-corrupt');
        break;
      }
      const start = this.cursor;
      let end = start; let complete = false;
      // Scan the available segment directly. Avoid per-character method,
      // regular-expression and string-concatenation overhead on mature logs.
      for (; end < this.text.length; end++) {
        if (!escaped && (quoted || compound)) {
          const markers = quoted ? STRING_STRUCTURE : VALUE_STRUCTURE;
          markers.lastIndex = end;
          const next = markers.exec(this.text);
          if (!next) { end = this.text.length; break; }
          end = next.index;
        }
        const code = this.text.charCodeAt(end);
        if (!quoted && depth === 0 && (parts.length > 0 || end > start) && !compound && !string
          && (code === 32 || code === 9 || code === 10 || code === 13 || code === 44 || code === 125 || code === 93)) {
          complete = true; break;
        }
        if (quoted) {
          if (escaped) escaped = false;
          else if (code === 92) escaped = true;
          else if (code === 34) { quoted = false; if (string && depth === 0) { end++; complete = true; break; } }
        } else if (code === 34) quoted = true;
        else if (code === 123 || code === 91) depth++;
        else if (code === 125 || code === 93) {
          depth--; if (depth < 0) throw new Error('policy-anchor-log-corrupt');
          if (compound && depth === 0) { end++; complete = true; break; }
        }
      }
      const segment = this.text.slice(start, end);
      bytes += Buffer.byteLength(segment);
      if (bytes > VALUE_LIMIT) throw new Error('policy-anchor-log-record-too-large');
      if (segment) parts.push(segment);
      this.cursor = end;
      if (complete) break;
    }
    // JSON.parse validates the complete bounded token's grammar, including
    // bracket kinds, escapes, control characters and scalar spellings.
    return JSON.parse(parts.join(''));
  }
}

/** Supports property order/whitespace from ordinary JSON writers. Unknown
 * root values remain bounded and syntax-checked; duplicate known keys fail. */
export function* anchorEntries(file: string): Generator<unknown> {
  const reader = new JsonReader(file);
  let version: unknown; let seenVersion = false; let seenEntries = false;
  try {
    reader.expect('{'); reader.whitespace();
    if (reader.peek() === '}') throw new Error('policy-anchor-log-corrupt');
    for (;;) {
      const key = reader.value(); if (typeof key !== 'string') throw new Error('policy-anchor-log-corrupt');
      reader.expect(':');
      if (key === 'entries') {
        if (seenEntries) throw new Error('policy-anchor-log-corrupt'); seenEntries = true;
        reader.expect('['); reader.whitespace();
        if (reader.peek() !== ']') {
          for (;;) {
            yield reader.value(); reader.whitespace();
            if (reader.peek() === ']') break;
            reader.expect(',');
          }
        }
        reader.expect(']');
      } else {
        const value = reader.value();
        if (key === 'version') { if (seenVersion) throw new Error('policy-anchor-log-corrupt'); seenVersion = true; version = value; }
      }
      reader.whitespace(); if (reader.peek() === '}') break; reader.expect(',');
    }
    reader.expect('}'); reader.whitespace();
    if (reader.peek() || !seenEntries || !seenVersion || version !== 1) throw new Error('policy-anchor-log-corrupt');
  } finally { reader.close(); }
}
function writeText(fd: number, text: string): void {
  const bytes = Buffer.from(text); let count = 0;
  while (count < bytes.length) {
    const next = writeSync(fd, bytes, count, bytes.length - count);
    if (!next) throw new Error('policy-anchor-log-short-write'); count += next;
  }
}
/** Serialization callback runs inside the runtime's existing durable atomic
 * writer. Failure removes the temporary file; no partial log is published. */
export function appendedAnchorLog(file: string | undefined, next: unknown, validate: (value: unknown, sequence: number, previous: string | null) => value is { hash: string }): AtomicJsonSource {
  return { [ATOMIC_JSON_WRITER](fd: number): void {
    let pending = ''; let pendingBytes = 0;
    const flush = () => { if (pendingBytes) writeText(fd, pending); pending = ''; pendingBytes = 0; };
    const emit = (text: string) => {
      const bytes = Buffer.byteLength(text);
      if (pendingBytes + bytes > CHUNK_BYTES) flush();
      if (bytes >= CHUNK_BYTES) writeText(fd, text);
      else { pending += text; pendingBytes += bytes; }
    };
    emit('{"version":1,"entries":[\n');
    let count = 0; let previous: string | null = null;
    if (file) {
      for (const entry of anchorEntries(file)) {
        if (!validate(entry, count, previous)) throw new Error('policy-anchor-log-corrupt');
        if (count) emit(',\n'); emit(JSON.stringify(entry));
        count++; previous = entry.hash;
      }
    }
    if (!validate(next, count, previous)) throw new Error('policy-anchor-log-corrupt');
    if (count) emit(',\n'); emit(JSON.stringify(next));
    emit('\n]}\n'); flush();
  } };
}
