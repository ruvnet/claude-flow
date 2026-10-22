/**
 * ruRE Phase 3 — .NET assembly metadata inspection (ADR-0004).
 * Reads ECMA-335 metadata from a Buffer. Never loads or executes the assembly.
 */

const MAX_LIST = 500;
const MAX_USER_STRINGS = 200;
const MAX_STR = 256;

export interface DotNetInfo {
  isManaged: boolean;
  runtimeVersion: string | null;
  assembly: { name: string; version: string } | null;
  assemblyRefs: { name: string; version: string }[];
  typeCount: number;
  types: string[];
  methodCount: number;
  pinvokes: { module: string; function: string }[];
  userStrings: string[];
  entryPointToken: number | null;
  warnings: string[];
  truncated: boolean;
}

type Col = number | string; // number = fixed byte size; string = S | G | B | T:n | C:name

const CODED: Record<string, { bits: number; tables: number[] }> = {
  TypeDefOrRef: { bits: 2, tables: [2, 1, 27] },
  HasConstant: { bits: 2, tables: [4, 8, 23] },
  HasCustomAttribute: { bits: 5, tables: [6, 4, 1, 2, 8, 9, 10, 0, 14, 23, 20, 17, 26, 27, 32, 35, 38, 39, 40, 42, 44, 43] },
  HasFieldMarshal: { bits: 1, tables: [4, 8] },
  HasDeclSecurity: { bits: 2, tables: [2, 6, 32] },
  MemberRefParent: { bits: 3, tables: [2, 1, 26, 6, 27] },
  HasSemantics: { bits: 1, tables: [20, 23] },
  MethodDefOrRef: { bits: 1, tables: [6, 10] },
  MemberForwarded: { bits: 1, tables: [4, 6] },
  Implementation: { bits: 2, tables: [38, 35, 39] },
  CustomAttributeType: { bits: 3, tables: [6, 10] },
  ResolutionScope: { bits: 2, tables: [0, 26, 35, 1] },
  TypeOrMethodDef: { bits: 1, tables: [2, 6] },
};

// ECMA-335 II.22 row layouts, indexed by table id.
const SCHEMA: Record<number, Col[]> = {
  0: [2, 'S', 'G', 'G', 'G'],
  1: ['C:ResolutionScope', 'S', 'S'],
  2: [4, 'S', 'S', 'C:TypeDefOrRef', 'T:4', 'T:6'],
  3: ['T:4'],
  4: [2, 'S', 'B'],
  5: ['T:6'],
  6: [4, 2, 2, 'S', 'B', 'T:8'],
  7: ['T:8'],
  8: [2, 2, 'S'],
  9: ['T:2', 'C:TypeDefOrRef'],
  10: ['C:MemberRefParent', 'S', 'B'],
  11: [1, 1, 'C:HasConstant', 'B'],
  12: ['C:HasCustomAttribute', 'C:CustomAttributeType', 'B'],
  13: ['C:HasFieldMarshal', 'B'],
  14: [2, 'C:HasDeclSecurity', 'B'],
  15: [2, 4, 'T:2'],
  16: [4, 'T:4'],
  17: ['B'],
  18: ['T:2', 'T:20'],
  19: ['T:20'],
  20: [2, 'S', 'C:TypeDefOrRef'],
  21: ['T:2', 'T:23'],
  22: ['T:23'],
  23: [2, 'S', 'B'],
  24: [2, 'T:6', 'C:HasSemantics'],
  25: ['T:2', 'C:MethodDefOrRef', 'C:MethodDefOrRef'],
  26: ['S'],
  27: ['B'],
  28: [2, 'C:MemberForwarded', 'S', 'T:26'],
  29: [4, 'T:4'],
  30: [4, 4],
  31: [4],
  32: [4, 2, 2, 2, 2, 4, 'B', 'S', 'S'],
  33: [4],
  34: [4, 4, 4],
  35: [2, 2, 2, 2, 4, 'B', 'S', 'S', 'B'],
  36: [4, 'T:35'],
  37: [4, 4, 4, 'T:35'],
  38: [4, 'S', 'B'],
  39: [4, 4, 'S', 'S', 'C:Implementation'],
  40: [4, 4, 'S', 'C:Implementation'],
  41: ['T:2', 'T:2'],
  42: [2, 2, 'C:TypeOrMethodDef', 'S'],
  43: ['C:MethodDefOrRef', 'B'],
  44: ['T:42', 'C:TypeDefOrRef'],
};

function emptyInfo(): DotNetInfo {
  return {
    isManaged: false, runtimeVersion: null, assembly: null, assemblyRefs: [], typeCount: 0, types: [],
    methodCount: 0, pinvokes: [], userStrings: [], entryPointToken: null, warnings: [], truncated: false,
  };
}

interface Stream { off: number; size: number }
interface Table { rows: number; rowSize: number; off: number; colOff: number[]; colSize: number[] }

function inBounds(b: Buffer, off: number, len: number): void {
  if (!Number.isInteger(off) || !Number.isInteger(len) || off < 0 || len < 0 || off + len > b.length) {
    throw new RangeError('out-of-bounds metadata range');
  }
}

function readPeLayout(b: Buffer): { toOff: (rva: number) => number; clrRva: number; clrSize: number } | null {
  if (b.length < 0x40 || b[0] !== 0x4d || b[1] !== 0x5a) return null;
  const pe = b.readUInt32LE(0x3c);
  if (b.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null;
  const coff = pe + 4;
  const nSections = Math.min(b.readUInt16LE(coff + 2), 96); // PE format limit
  const optSize = b.readUInt16LE(coff + 16);
  const opt = coff + 20;
  const plus = b.readUInt16LE(opt) === 0x20b;
  const secs: { va: number; span: number; raw: number }[] = [];
  for (let i = 0; i < nSections; i++) {
    const o = opt + optSize + i * 40;
    const vsize = b.readUInt32LE(o + 8);
    secs.push({ va: b.readUInt32LE(o + 12), span: Math.max(vsize, b.readUInt32LE(o + 16)), raw: b.readUInt32LE(o + 20) });
  }
  const toOff = (rva: number): number => {
    const s = secs.find((x) => rva >= x.va && rva < x.va + x.span);
    if (!s) throw new RangeError('unmapped RVA');
    return s.raw + (rva - s.va);
  };
  const dirBase = opt + (plus ? 112 : 96);
  return { toOff, clrRva: b.readUInt32LE(dirBase + 14 * 8), clrSize: b.readUInt32LE(dirBase + 14 * 8 + 4) };
}

function readCompressedUInt(b: Buffer, off: number, end: number): { value: number; len: number } {
  if (off >= end) throw new RangeError('compressed int');
  const first = b[off];
  if ((first & 0x80) === 0) return { value: first, len: 1 };
  if ((first & 0xc0) === 0x80) {
    if (off + 2 > end) throw new RangeError('compressed int');
    return { value: ((first & 0x3f) << 8) | b[off + 1], len: 2 };
  }
  if (off + 4 > end) throw new RangeError('compressed int');
  return { value: ((first & 0x1f) << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3], len: 4 };
}

function guarded(info: DotNetInfo, label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    info.warnings.push(`${label}: ${err instanceof RangeError ? err.message : String(err)}`);
  }
}

/** Inspects a managed assembly's metadata. Never throws on hostile input. */
export function parseDotNet(b: Buffer): DotNetInfo {
  const info = emptyInfo();
  try {
    parseInto(b, info);
  } catch (err) {
    info.warnings.push(`metadata parse failed: ${err instanceof RangeError ? err.message : String(err)}`);
  }
  return info;
}

function parseInto(b: Buffer, info: DotNetInfo): void {
  const layout = readPeLayout(b);
  if (!layout) {
    info.warnings.push('not a PE file');
    return;
  }
  if (!layout.clrRva) return; // native PE: isManaged stays false
  info.isManaged = true;

  const cor = layout.toOff(layout.clrRva);
  inBounds(b, cor, 24);
  info.entryPointToken = b.readUInt32LE(cor + 20) || null;
  const meta = layout.toOff(b.readUInt32LE(cor + 8));
  const metaSize = b.readUInt32LE(cor + 12);
  inBounds(b, meta, Math.min(metaSize, 32));
  if (b.readUInt32LE(meta) !== 0x424a5342) throw new RangeError('missing BSJB metadata signature');
  const verLen = b.readUInt32LE(meta + 12);
  if (verLen > 256) throw new RangeError('implausible version string length');
  inBounds(b, meta + 16, verLen);
  info.runtimeVersion = b.toString('latin1', meta + 16, meta + 16 + verLen).replace(/\0+$/, '');

  const nStreams = b.readUInt16LE(meta + 18 + verLen);
  const streams = new Map<string, Stream>();
  let p = meta + 20 + verLen;
  for (let i = 0; i < Math.min(nStreams, 16); i++) {
    inBounds(b, p, 9);
    const off = b.readUInt32LE(p);
    const size = b.readUInt32LE(p + 4);
    let q = p + 8;
    while (q < b.length && b[q] !== 0 && q - p < 40) q++;
    const name = b.toString('latin1', p + 8, q);
    inBounds(b, meta + off, size);
    streams.set(name, { off: meta + off, size });
    p = p + 8 + Math.ceil((q - (p + 8) + 1) / 4) * 4;
  }

  const strHeap = streams.get('#Strings');
  const us = streams.get('#US');
  const tbl = streams.get('#~') ?? streams.get('#-');
  if (!tbl || !strHeap) throw new RangeError('missing #~ or #Strings stream');
  const str = (idx: number): string => {
    if (idx >= strHeap.size) throw new RangeError('string index out of range');
    const start = strHeap.off + idx;
    let end = start;
    const limit = Math.min(strHeap.off + strHeap.size, start + MAX_STR);
    while (end < limit && b[end] !== 0) end++;
    return b.toString('utf8', start, end);
  };

  guarded(info, 'tables', () => readTables(b, info, tbl, str));

  if (us) {
    guarded(info, 'user strings', () => {
      const end = us.off + us.size;
      let o = us.off + 1;
      while (o < end && info.userStrings.length < MAX_USER_STRINGS) {
        const { value, len } = readCompressedUInt(b, o, end);
        o += len;
        if (value === 0) continue;
        if (o + value > end) break;
        const text = b.toString('utf16le', o, o + Math.max(0, value - 1));
        if (text.trim()) info.userStrings.push(text.slice(0, MAX_STR));
        o += value;
      }
      if (o < end) info.truncated = true;
    });
  }
}

function readTables(b: Buffer, info: DotNetInfo, tbl: Stream, str: (i: number) => string): void {
  inBounds(b, tbl.off, 24);
  const heapSizes = b[tbl.off + 6];
  const valid = b.readBigUInt64LE(tbl.off + 8);
  const sIdx = heapSizes & 1 ? 4 : 2;
  const gIdx = heapSizes & 2 ? 4 : 2;
  const bIdx = heapSizes & 4 ? 4 : 2;

  const rows: number[] = new Array(64).fill(0);
  let p = tbl.off + 24;
  for (let t = 0; t < 64; t++) {
    if ((valid >> BigInt(t)) & 1n) {
      inBounds(b, p, 4);
      rows[t] = b.readUInt32LE(p);
      p += 4;
    }
  }
  const tableIdx = (t: number): number => (rows[t] < 0x10000 ? 2 : 4);
  const codedIdx = (name: string): number => {
    const c = CODED[name];
    const max = Math.max(...c.tables.map((t) => rows[t]));
    return max < 2 ** (16 - c.bits) ? 2 : 4;
  };

  const tables: Record<number, Table> = {};
  let off = p;
  for (let t = 0; t < 64; t++) {
    if (!rows[t]) continue;
    const schema = SCHEMA[t];
    if (!schema) throw new RangeError(`unknown metadata table ${t}`);
    const colSize = schema.map((c) => (typeof c === 'number' ? c : c === 'S' ? sIdx : c === 'G' ? gIdx : c === 'B' ? bIdx : c.startsWith('T:') ? tableIdx(Number(c.slice(2))) : codedIdx(c.slice(2))));
    const colOff: number[] = [];
    let rowSize = 0;
    for (const s of colSize) {
      colOff.push(rowSize);
      rowSize += s;
    }
    tables[t] = { rows: rows[t], rowSize, off, colOff, colSize };
    off += rows[t] * rowSize;
    if (off > tbl.off + tbl.size) throw new RangeError('table extents exceed #~ stream');
  }

  const cell = (t: number, row: number, col: number): number => {
    const tb = tables[t];
    const o = tb.off + row * tb.rowSize + tb.colOff[col];
    const size = tb.colSize[col];
    return size === 1 ? b[o] : size === 2 ? b.readUInt16LE(o) : b.readUInt32LE(o);
  };

  if (tables[32]) {
    info.assembly = { name: str(cell(32, 0, 7)), version: `${cell(32, 0, 1)}.${cell(32, 0, 2)}.${cell(32, 0, 3)}.${cell(32, 0, 4)}` };
  }
  if (tables[35]) {
    const n = Math.min(tables[35].rows, MAX_LIST);
    if (n < tables[35].rows) info.truncated = true;
    for (let i = 0; i < n; i++) {
      info.assemblyRefs.push({ name: str(cell(35, i, 6)), version: `${cell(35, i, 0)}.${cell(35, i, 1)}.${cell(35, i, 2)}.${cell(35, i, 3)}` });
    }
  }
  if (tables[2]) {
    info.typeCount = tables[2].rows;
    const n = Math.min(tables[2].rows, MAX_LIST);
    if (n < tables[2].rows) info.truncated = true;
    for (let i = 0; i < n; i++) {
      const name = str(cell(2, i, 1));
      const ns = str(cell(2, i, 2));
      info.types.push(ns ? `${ns}.${name}` : name);
    }
  }
  info.methodCount = tables[6]?.rows ?? 0;
  if (tables[28] && tables[26]) {
    const n = Math.min(tables[28].rows, MAX_LIST);
    if (n < tables[28].rows) info.truncated = true;
    for (let i = 0; i < n; i++) {
      const scope = cell(28, i, 3); // 1-based ModuleRef row
      if (scope < 1 || scope > tables[26].rows) continue;
      info.pinvokes.push({ module: str(cell(26, scope - 1, 0)), function: str(cell(28, i, 2)) });
    }
  }
}
