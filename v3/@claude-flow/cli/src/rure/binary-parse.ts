/**
 * ruRE Phase 2 — container-level static inspection of ELF / PE / Mach-O
 * (ADR-0003). Reads integers and C-strings from a Buffer at bounds-checked
 * offsets. Never loads, maps, or executes the target.
 */

export const MAX_BINARY_BYTES = 128 * 1024 * 1024;
const MAX_SECTIONS = 4096;
const MAX_SYMBOLS = 2000;
const MAX_PE_SECTIONS = 96; // PE format limit
const ITERATION_BUDGET = 200_000;

// Total table-walk steps allowed per parseBinary call. Header-declared counts and
// overlapping regions can multiply work far beyond file size; this bounds it.
let budget = ITERATION_BUDGET;
function tick(): void {
  if (--budget < 0) throw new RangeError('iteration budget exhausted');
}

export interface SectionInfo {
  name: string;
  offset: number;
  size: number;
}

export interface BinaryInfo {
  format: 'elf' | 'pe' | 'macho' | 'macho-fat' | 'unknown';
  arch: string;
  bits: 32 | 64 | null;
  endianness: 'little' | 'big';
  kind: string;
  entryPoint: number | null;
  sections: SectionInfo[];
  libraries: string[];
  imports: string[];
  exports: string[];
  archs?: string[];
  warnings: string[];
  truncated: boolean;
}

function empty(format: BinaryInfo['format']): BinaryInfo {
  return {
    format, arch: 'unknown', bits: null, endianness: 'little', kind: 'unknown', entryPoint: null,
    sections: [], libraries: [], imports: [], exports: [], warnings: [], truncated: false,
  };
}

function describeError(err: unknown): string {
  if (err instanceof RangeError) return err.message === 'iteration budget exhausted' ? err.message : 'out-of-bounds read';
  return String(err);
}

/** Runs one structure parse; a failure becomes a warning, not an abort. */
function guarded(info: BinaryInfo, label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    info.warnings.push(`${label}: ${describeError(err)}`);
  }
}

function cstr(b: Buffer, off: number, max = 512): string {
  if (!Number.isInteger(off) || off < 0 || off >= b.length) throw new RangeError('string offset');
  const limit = Math.min(b.length, off + max);
  let end = off;
  while (end < limit && b[end] !== 0) end++;
  return b.toString('latin1', off, end);
}

function safeNum(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('value exceeds safe integer');
  return Number(v);
}

function pushCapped(info: BinaryInfo, list: string[], value: string): void {
  if (!value) return;
  if (list.length >= MAX_SYMBOLS) {
    info.truncated = true;
    return;
  }
  list.push(value);
}

const ELF_MACHINE: Record<number, string> = {
  3: 'x86', 8: 'mips', 20: 'ppc', 21: 'ppc64', 40: 'arm', 62: 'x86-64', 183: 'aarch64', 243: 'riscv',
};

function parseElf(b: Buffer): BinaryInfo {
  const info = empty('elf');
  const is64 = b[4] === 2;
  const le = b[5] !== 2;
  info.bits = is64 ? 64 : 32;
  info.endianness = le ? 'little' : 'big';
  const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const u64 = (o: number) => safeNum(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o));
  const word = (o: number) => (is64 ? u64(o) : u32(o));

  info.arch = ELF_MACHINE[u16(18)] ?? `machine-${u16(18)}`;
  const type = u16(16);
  info.kind = type === 2 ? 'executable' : type === 3 ? 'shared-or-pie' : type === 1 ? 'object' : type === 4 ? 'core' : 'unknown';
  guarded(info, 'entry point', () => { info.entryPoint = word(24); });

  interface Sh { name: number; type: number; offset: number; size: number; link: number; entsize: number }
  const shdrs: Sh[] = [];
  guarded(info, 'section headers', () => {
    const shoff = word(is64 ? 40 : 32);
    const shentsize = u16(is64 ? 58 : 46);
    let shnum = u16(is64 ? 60 : 48);
    if (shoff === 0 || shentsize === 0) {
      info.warnings.push('no section headers: libraries and symbols are unavailable');
      return;
    }
    if (shnum > MAX_SECTIONS) {
      shnum = MAX_SECTIONS;
      info.truncated = true;
    }
    for (let i = 0; i < shnum; i++) {
      const o = shoff + i * shentsize;
      shdrs.push(is64
        ? { name: u32(o), type: u32(o + 4), offset: u64(o + 24), size: u64(o + 32), link: u32(o + 40), entsize: u64(o + 56) }
        : { name: u32(o), type: u32(o + 4), offset: u32(o + 16), size: u32(o + 20), link: u32(o + 24), entsize: u32(o + 36) });
    }
    const strIdx = u16(is64 ? 62 : 50);
    const strtab = shdrs[strIdx];
    for (const s of shdrs) {
      let name = '';
      if (strtab) {
        try { name = cstr(b, strtab.offset + s.name, 128); } catch { /* unnamed */ }
      }
      info.sections.push({ name, offset: s.offset, size: s.size });
    }
  });

  guarded(info, 'dynamic', () => {
    for (const d of shdrs.filter((s) => s.type === 6)) {
      const dynstr = shdrs[d.link];
      if (!dynstr) continue;
      const step = is64 ? 16 : 8;
      for (let o = d.offset; o + step <= d.offset + d.size && o + step <= b.length; o += step) {
        tick();
        const tag = word(o);
        if (tag === 0) break;
        if (tag === 1) pushCapped(info, info.libraries, cstr(b, dynstr.offset + word(o + (is64 ? 8 : 4))));
      }
    }
  });

  guarded(info, 'dynamic symbols', () => {
    for (const d of shdrs.filter((s) => s.type === 11)) {
      const strs = shdrs[d.link];
      const minSym = is64 ? 24 : 16;
      const step = d.entsize >= minSym ? d.entsize : minSym;
      if (!strs) continue;
      for (let o = d.offset; o + step <= d.offset + d.size && o + step <= b.length; o += step) {
        tick();
        const nameOff = u32(o);
        const shndx = u16(o + (is64 ? 6 : 14));
        const bind = b[o + (is64 ? 4 : 12)] >> 4;
        if (nameOff === 0) continue;
        const name = cstr(b, strs.offset + nameOff);
        if (shndx === 0) pushCapped(info, info.imports, name);
        else if (bind === 1 || bind === 2) pushCapped(info, info.exports, name);
      }
    }
  });
  return info;
}

const PE_MACHINE: Record<number, string> = { 0x14c: 'x86', 0x8664: 'x86-64', 0x1c0: 'arm', 0x1c4: 'arm-thumb2', 0xaa64: 'aarch64' };

function parsePe(b: Buffer): BinaryInfo {
  const info = empty('pe');
  const pe = b.readUInt32LE(0x3c);
  if (b.toString('latin1', pe, pe + 4) !== 'PE\0\0') {
    info.warnings.push('missing PE signature');
    return info;
  }
  const coff = pe + 4;
  const machine = b.readUInt16LE(coff);
  const nSections = b.readUInt16LE(coff + 2);
  const optSize = b.readUInt16LE(coff + 16);
  const chars = b.readUInt16LE(coff + 18);
  const opt = coff + 20;
  const plus = b.readUInt16LE(opt) === 0x20b;
  info.arch = PE_MACHINE[machine] ?? `machine-0x${machine.toString(16)}`;
  info.bits = plus ? 64 : 32;
  info.kind = chars & 0x2000 ? 'dll' : 'executable';
  info.entryPoint = b.readUInt32LE(opt + 16);

  const secs: { va: number; span: number; raw: number }[] = [];
  guarded(info, 'sections', () => {
    const n = Math.min(nSections, MAX_PE_SECTIONS);
    if (n < nSections) info.truncated = true;
    for (let i = 0; i < n; i++) {
      const o = opt + optSize + i * 40;
      const vsize = b.readUInt32LE(o + 8);
      const va = b.readUInt32LE(o + 12);
      const rawSize = b.readUInt32LE(o + 16);
      const raw = b.readUInt32LE(o + 20);
      info.sections.push({ name: b.toString('latin1', o, o + 8).replace(/\0+$/, ''), offset: raw, size: rawSize });
      secs.push({ va, span: Math.max(vsize, rawSize), raw });
    }
  });
  const toOff = (rva: number): number => {
    const s = secs.find((x) => rva >= x.va && rva < x.va + x.span);
    if (!s) throw new RangeError('unmapped RVA');
    return s.raw + (rva - s.va);
  };
  const dirBase = opt + (plus ? 112 : 96);
  const dir = (i: number) => ({ rva: b.readUInt32LE(dirBase + i * 8), size: b.readUInt32LE(dirBase + i * 8 + 4) });

  guarded(info, 'imports', () => {
    const imp = dir(1);
    if (!imp.rva) return;
    const step = plus ? 8 : 4;
    for (let o = toOff(imp.rva), n = 0; n < MAX_SYMBOLS; o += 20, n++) {
      tick();
      const origThunk = b.readUInt32LE(o);
      const nameRva = b.readUInt32LE(o + 12);
      const firstThunk = b.readUInt32LE(o + 16);
      if (!origThunk && !nameRva && !firstThunk) break;
      const lib = cstr(b, toOff(nameRva), 256);
      pushCapped(info, info.libraries, lib);
      let t = toOff(origThunk || firstThunk);
      for (let k = 0; k < MAX_SYMBOLS; k++, t += step) {
        tick();
        const entry = plus ? b.readBigUInt64LE(t) : BigInt(b.readUInt32LE(t));
        if (entry === 0n) break;
        const byOrdinal = entry >> BigInt(plus ? 63 : 31);
        if (byOrdinal) pushCapped(info, info.imports, `${lib}!#${entry & 0xffffn}`);
        else pushCapped(info, info.imports, `${lib}!${cstr(b, toOff(Number(entry & 0x7fffffffn)) + 2, 256)}`);
      }
    }
  });

  guarded(info, 'exports', () => {
    const exp = dir(0);
    if (!exp.rva) return;
    const base = toOff(exp.rva);
    const count = Math.min(b.readUInt32LE(base + 24), MAX_SYMBOLS);
    const names = toOff(b.readUInt32LE(base + 32));
    for (let i = 0; i < count; i++) {
      tick();
      pushCapped(info, info.exports, cstr(b, toOff(b.readUInt32LE(names + i * 4)), 256));
    }
  });
  return info;
}

const MACHO_CPU: Record<number, string> = { 7: 'x86', 0x01000007: 'x86-64', 12: 'arm', 0x0100000c: 'aarch64', 18: 'ppc', 0x01000012: 'ppc64' };
const MACHO_FILETYPE: Record<number, string> = { 1: 'object', 2: 'executable', 6: 'dylib', 8: 'bundle', 10: 'dsym' };
const LC_DYLIBS = new Set([0xc, 0x80000018, 0x8000001f, 0x80000023]);

function parseMachO(b: Buffer, base = 0): BinaryInfo {
  const info = empty('macho');
  const magic = b.readUInt32BE(base);
  const le = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const is64 = magic === 0xfeedfacf || magic === 0xcffaedfe;
  info.bits = is64 ? 64 : 32;
  info.endianness = le ? 'little' : 'big';
  const u32 = (o: number) => (le ? b.readUInt32LE(base + o) : b.readUInt32BE(base + o));
  const u64 = (o: number) => safeNum(le ? b.readBigUInt64LE(base + o) : b.readBigUInt64BE(base + o));
  const cpu = u32(4);
  info.arch = MACHO_CPU[cpu] ?? `cpu-0x${cpu.toString(16)}`;
  info.kind = MACHO_FILETYPE[u32(12)] ?? 'unknown';
  const ncmds = Math.min(u32(16), MAX_SECTIONS);
  guarded(info, 'load commands', () => {
    let o = is64 ? 32 : 28;
    for (let i = 0; i < ncmds; i++) {
      const cmd = u32(o);
      const size = u32(o + 4);
      if (size < 8) throw new RangeError('bad load command size');
      if (LC_DYLIBS.has(cmd)) pushCapped(info, info.libraries, cstr(b, base + o + u32(o + 8), 512));
      else if (cmd === 0x80000028) info.entryPoint = u64(o + 8);
      else if (cmd === 0x1 || cmd === 0x19) {
        const seg64 = cmd === 0x19;
        const nsects = u32(o + (seg64 ? 64 : 48));
        let so = o + (seg64 ? 72 : 56);
        for (let s = 0; s < nsects && info.sections.length < MAX_SECTIONS; s++, so += seg64 ? 80 : 68) {
          info.sections.push({
            name: `${b.toString('latin1', base + so + 16, base + so + 32).replace(/\0+$/, '')},${b.toString('latin1', base + so, base + so + 16).replace(/\0+$/, '')}`,
            offset: u32(so + (seg64 ? 48 : 40)),
            size: seg64 ? u64(so + 40) : u32(so + 36),
          });
        }
      }
      o += size;
    }
  });
  return info;
}

function parseFat(b: Buffer): BinaryInfo {
  const info = empty('macho-fat');
  info.endianness = 'big';
  const n = Math.min(b.readUInt32BE(4), 16);
  let first: number | null = null;
  for (let i = 0; i < n; i++) {
    const o = 8 + i * 20;
    const cpu = b.readUInt32BE(o);
    (info.archs ??= []).push(MACHO_CPU[cpu] ?? `cpu-0x${cpu.toString(16)}`);
    if (first === null) first = b.readUInt32BE(o + 8);
  }
  info.arch = (info.archs ?? []).join('+') || 'unknown';
  if (first !== null) {
    guarded(info, 'first slice', () => {
      const slice = parseMachO(b, first!);
      Object.assign(info, { bits: slice.bits, kind: slice.kind, entryPoint: slice.entryPoint, sections: slice.sections, libraries: slice.libraries });
      info.warnings.push(...slice.warnings);
      info.warnings.push('fat binary: sections and libraries are from the first slice only');
    });
  }
  return info;
}

/** Detects the container format from magic bytes and parses it. Never throws on hostile input. */
export function parseBinary(b: Buffer): BinaryInfo {
  budget = ITERATION_BUDGET;
  try {
    if (b.length >= 20 && b[0] === 0x7f && b.toString('latin1', 1, 4) === 'ELF') return parseElf(b);
    if (b.length >= 0x40 && b[0] === 0x4d && b[1] === 0x5a) return parsePe(b);
    if (b.length >= 32) {
      const m = b.readUInt32BE(0);
      if (m === 0xfeedface || m === 0xfeedfacf || m === 0xcefaedfe || m === 0xcffaedfe) return parseMachO(b);
      if (m === 0xcafebabe && b.readUInt32BE(4) >= 1 && b.readUInt32BE(4) <= 16) return parseFat(b);
    }
  } catch (err) {
    const info = empty('unknown');
    info.warnings.push(`header parse failed: ${describeError(err)}`);
    return info;
  }
  const info = empty('unknown');
  info.warnings.push('unrecognized container format (expected ELF, PE, or Mach-O)');
  return info;
}

export interface ExtractedString {
  value: string;
  offset: number;
}

/** Printable-ASCII runs, capped. Deterministic, bounded by file size cap. */
export function extractStrings(b: Buffer, minLen = 6, maxCount = 200): { strings: ExtractedString[]; truncated: boolean } {
  const strings: ExtractedString[] = [];
  let start = -1;
  for (let i = 0; i <= b.length; i++) {
    const printable = i < b.length && b[i] >= 0x20 && b[i] < 0x7f;
    if (printable) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= minLen) {
        if (strings.length >= maxCount) return { strings, truncated: true };
        strings.push({ value: b.toString('latin1', start, Math.min(i, start + 256)), offset: start });
      }
      start = -1;
    }
  }
  return { strings, truncated: false };
}
