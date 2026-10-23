/**
 * ruRE Phase 5 — the CUDA fatbin container (ADR-0006). A `.nv_fatbin` section is several containers back to back; each is a 16-byte
 * header (magic 0xBA55ED50, version, header size, payload size) and entries (PTX text or a cubin, possibly compressed). Layout read from
 * real nvcc output, not from a specification. Parses, never executes; every offset is bounds-checked; decompression is capped twice
 * (the claimed size is refused first, and the decompressor is handed the cap as its own limit).
 */
import * as zlib from 'node:zlib';

export const FATBIN_MAGIC = 0xba55ed50;
export const MAX_CONTAINERS = 64;
export const MAX_ENTRIES = 256;
/** The most one entry may decompress to, and the most all entries of one file may. */
export const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const FLAG_LZ4 = 0x2000n;
const FLAG_ZSTD = 0x8000n;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export type Compression = 'none' | 'zstd' | 'lz4' | 'unknown';
export type Zstd = (input: Buffer, maxOutput: number) => Buffer;

/**
 * zstd where this Node has it (22.15 and later); null where it does not, which is said, not hidden. A namespace import and a type check, not a
 * named import: on Node 20 `zstdDecompressSync` is not an export, and a named import of it would stop the whole module from loading.
 */
const zstdFn = (zlib as unknown as { zstdDecompressSync?: (input: Buffer, options: { maxOutputLength: number }) => Buffer }).zstdDecompressSync;

export const defaultZstd: Zstd | null = typeof zstdFn === 'function' ? (input, max) => zstdFn(input, { maxOutputLength: max }) : null;

export interface RawEntry {
  container: number;
  index: number;
  kind: number;
  headerSize: number;
  paddedSize: number;
  compressedSize: number;
  version: number;
  archNumber: number;
  objNameOffset: number;
  objNameLen: number;
  flags: bigint;
  decompressedSize: number;
  /** Where the payload starts in the buffer, and how many bytes of it are really there. */
  payloadOffset: number;
  payloadLength: number;
}

const num = (v: bigint): number => (v > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(v));

/** Walks the containers in b[start, end). A malformed header ends the walk with a warning; what was read stays. */
export function walkFatbin(b: Buffer, start: number, end: number, warnings: string[]): { entries: RawEntry[]; containers: number; truncated: boolean } {
  const entries: RawEntry[] = [];
  let containers = 0;
  let pos = start;
  let truncated = false;

  while (pos + 16 <= end && b.readUInt32LE(pos) === FATBIN_MAGIC) {
    if (containers >= MAX_CONTAINERS) {
      truncated = true;
      warnings.push(`more than ${MAX_CONTAINERS} fatbin containers: the rest are not read`);
      break;
    }

    const headerSize = b.readUInt16LE(pos + 6);
    const claimed = num(b.readBigUInt64LE(pos + 8));

    if (headerSize < 16 || headerSize > 4096 || pos + headerSize > end) {
      warnings.push(`container ${containers}: header size ${headerSize} is out of range, the walk stops`);
      break;
    }

    const limit = Math.min(end, pos + headerSize + claimed);

    if (pos + headerSize + claimed > end) warnings.push(`container ${containers}: its size (${claimed}) runs past the data, read up to the end`);
    containers += 1;

    let p = pos + headerSize;

    while (p + 16 <= limit) {
      if (entries.length >= MAX_ENTRIES) {
        truncated = true;
        warnings.push(`more than ${MAX_ENTRIES} fatbin entries: the rest are not read`);

        return { entries, containers, truncated };
      }

      const size = b.readUInt32LE(p + 4);

      if (size < 16 || size > 4096 || p + size > limit) {
        warnings.push(`container ${containers - 1}: an entry header length of ${size} is out of range, this container's walk stops`);
        break;
      }

      const padded = num(b.readBigUInt64LE(p + 8));
      const full = size >= 64;
      const payloadOffset = p + size;
      const payloadLength = Math.max(0, Math.min(padded, limit - payloadOffset));

      if (!full) warnings.push(`container ${containers - 1}: an entry header of ${size} bytes is shorter than the 64 that carry its fields`);
      if (padded > limit - payloadOffset) warnings.push(`container ${containers - 1}: an entry claims ${padded} payload bytes, only ${limit - payloadOffset} are there`);

      entries.push({
        container: containers - 1,
        index: entries.length,
        kind: b.readUInt16LE(p),
        headerSize: size,
        paddedSize: padded,
        compressedSize: full ? b.readUInt32LE(p + 16) : 0,
        version: full ? b.readUInt32LE(p + 24) : 0,
        archNumber: full ? b.readUInt32LE(p + 28) : 0,
        objNameOffset: full ? b.readUInt32LE(p + 32) : 0,
        objNameLen: full ? b.readUInt32LE(p + 36) : 0,
        flags: full ? b.readBigUInt64LE(p + 40) : 0n,
        decompressedSize: full ? num(b.readBigUInt64LE(p + 56)) : 0,
        payloadOffset,
        payloadLength,
      });
      p += size + padded;
    }

    pos = limit;
  }

  const rest = b.subarray(pos, end);

  if (rest.length > 0 && rest.some(byte => byte !== 0)) warnings.push(`${rest.length} bytes after the last container are not a fatbin`);

  return { entries, containers, truncated };
}

/**
 * An LZ4 block (no frame), as CUDA 12 writes. Original: reads only inside `src`, writes only inside `maxOut`, refuses a match offset
 * that points before the start of the output. Throws RangeError on any malformed input.
 */
export function lz4Block(src: Buffer, maxOut: number): Buffer {
  const out = Buffer.allocUnsafe(maxOut);
  let ip = 0;
  let op = 0;

  while (ip < src.length) {
    const token = src[ip++] as number;
    let literals = token >> 4;

    if (literals === 15) {
      let more: number;

      do {
        if (ip >= src.length) throw new RangeError('literal length runs past the input');
        more = src[ip++] as number;
        literals += more;
        if (literals > maxOut) throw new RangeError('literal length past the cap');
      } while (more === 255);
    }

    if (ip + literals > src.length) throw new RangeError('literals run past the input');
    if (op + literals > maxOut) throw new RangeError('output past the cap');
    src.copy(out, op, ip, ip + literals);
    ip += literals;
    op += literals;

    if (ip >= src.length) break;
    if (ip + 2 > src.length) throw new RangeError('match offset runs past the input');

    const offset = src.readUInt16LE(ip);

    ip += 2;
    if (offset === 0 || offset > op) throw new RangeError('match offset points before the start of the output');

    let length = token & 15;

    if (length === 15) {
      let more: number;

      do {
        if (ip >= src.length) throw new RangeError('match length runs past the input');
        more = src[ip++] as number;
        length += more;
        if (length > maxOut) throw new RangeError('match length past the cap');
      } while (more === 255);
    }

    length += 4;
    if (op + length > maxOut) throw new RangeError('output past the cap');
    // Byte by byte: a match may overlap what it is writing (that is how a run is encoded).
    for (let i = 0; i < length; i++) out[op + i] = out[op - offset + i] as number;
    op += length;
  }

  return out.subarray(0, op);
}

export interface Payload {
  /** The bytes of the cubin or the PTX text, or null when they could not be read (the reason is in `note`). */
  data: Buffer | null;
  compressed: Compression;
  note?: string;
}

/** The entry's payload as bytes, decompressed when it is and when it may be. `budget.left` is spent by what each attempt claims, win or lose. */
export function readPayload(b: Buffer, entry: RawEntry, zstd: Zstd | null, budget: { left: number }): Payload {
  const raw = b.subarray(entry.payloadOffset, entry.payloadOffset + entry.payloadLength);
  const isZstd = (entry.flags & FLAG_ZSTD) !== 0n;
  const isLz4 = (entry.flags & FLAG_LZ4) !== 0n;

  if (!isZstd && !isLz4) return { data: raw, compressed: 'none' };
  if (isZstd && isLz4) return { data: null, compressed: 'unknown', note: 'both the zstd and the lz4 flag are set: not read' };

  const kind: Compression = isZstd ? 'zstd' : 'lz4';
  const claimed = entry.decompressedSize;

  if (claimed <= 0) return { data: null, compressed: kind, note: 'the header gives no decompressed size: not read' };
  if (claimed > MAX_ENTRY_BYTES) return { data: null, compressed: kind, note: `claims ${claimed} bytes decompressed: over the ${MAX_ENTRY_BYTES}-byte cap, not read` };
  if (claimed > budget.left) return { data: null, compressed: kind, note: 'the total decompression budget for this file is spent: not read' };

  const packed = raw.subarray(0, entry.compressedSize > 0 ? Math.min(entry.compressedSize, raw.length) : raw.length);

  if (isZstd) {
    if (!packed.subarray(0, 4).equals(ZSTD_MAGIC)) return { data: null, compressed: 'unknown', note: 'the zstd flag is set but the payload does not start with a zstd frame: not read' };
    if (zstd === null) return { data: null, compressed: 'zstd', note: 'this Node cannot read zstd (it needs 22.15 or later)' };
  }

  // Charged when the attempt starts, not when it succeeds: a stream that fails late must not be retryable by 256 entries for 4 GiB of work.
  budget.left -= claimed;

  try {
    const out = isZstd ? zstd!(packed, claimed) : lz4Block(packed, claimed);

    if (out.length !== claimed) return { data: null, compressed: kind, note: `decompressed to ${out.length} bytes, the header says ${claimed}: not used` };

    return { data: out, compressed: kind };
  } catch (err) {
    return { data: null, compressed: kind, note: `could not be decompressed: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}` };
  }
}
