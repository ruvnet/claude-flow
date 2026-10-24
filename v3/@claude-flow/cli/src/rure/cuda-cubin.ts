/**
 * ruRE Phase 5 — a cubin (ADR-0006): an ELF64 for the GPU (`e_machine` 190). Read here for its kernels, from the symbol table, which
 * `parseBinary` does not read. Layout checked against `cuobjdump -symbols` and `-res-usage` on real nvcc output. Bounds-checked
 * throughout; never throws on hostile input (a failure is a warning and what was read stays).
 */

export const EM_CUDA = 190;
const MAX_SECTIONS = 4096;
const MAX_SYMBOLS = 2000;
export const MAX_KERNELS = 500;
const NAME_MAX = 200;
const STO_CUDA_ENTRY = 0x10;
const EIATTR_REGCOUNT = 0x2f;
const MAX_INFO_RECORDS = 4096;

export interface CubinKernel {
  /** The mangled name as in the symbol table. */
  name: string;
  /** The plain identifier of a simple `_Z<len><name>...` name, else null: full demangling is not attempted. */
  identifier: string | null;
  /** A kernel (launchable, `STO_CUDA_ENTRY`) or a device function (callable from the GPU only). */
  isEntry: boolean;
  codeBytes: number | null;
  /** codeBytes / 16, for SM 7.0 and later (a SASS instruction is 16 bytes there); null otherwise. An estimate, not a decode. */
  instructionEstimate: number | null;
  /** The register count from the global .nv.info section (EIATTR_REGCOUNT: a symbol index and a count); null when no record names this symbol. */
  registers: number | null;
  constantBytes: number | null;
  sharedBytes: number | null;
  localBytes: number | null;
}

export interface CubinInfo {
  /** SM number from `e_flags` (80 for sm_80), or null. */
  archFlag: number | null;
  sectionCount: number;
  kernels: CubinKernel[];
  warnings: string[];
  truncated: boolean;
}

/**
 * The SM number in `e_flags`. Where it sits depends on the ABI the toolchain wrote: a cubin from CUDA 12 (ELF OS ABI 51) for sm_70 to sm_90 keeps it in the
 * low byte (sm_70 is 0x460546: 0x46 twice, around the texture and address bits), while CUDA 13, and CUDA 12.8 for sm_120, use OS ABI 65 and the second byte
 * (sm_80 is 0x06005004). Reading the second byte of an ABI 51 cubin gave "sm_5" for every one of them. An OS ABI we have not seen falls back to whichever
 * byte is a plausible SM number.
 */
export function smOfFlags(flags: number, osAbi: number): number | null {
  const low = flags & 0xff;
  const second = (flags >>> 8) & 0xff;
  const plausible = (n: number): boolean => n >= 20 && n <= 199;

  if (osAbi === 65) return second;
  if (osAbi === 51) return low;

  return plausible(second) ? second : plausible(low) ? low : null;
}

export const isCubin = (b: Buffer): boolean => b.length >= 0x40 && b[0] === 0x7f && b.toString('latin1', 1, 4) === 'ELF' && b[4] === 2 && b[5] === 1 && b.readUInt16LE(0x12) === EM_CUDA;

const cstr = (b: Buffer, at: number, end: number): string => {
  if (at < 0 || at >= end) return '';

  let stop = at;

  while (stop < end && stop - at < NAME_MAX && b[stop] !== 0) stop += 1;

  return b.toString('latin1', at, stop);
};

/** The register count per symbol index from the global .nv.info section: records of (format u8, attribute u8, size u16) and a payload. */
function regCounts(b: Buffer, offset: number, size: number): Map<number, number> {
  const out = new Map<number, number>();
  const end = Math.min(b.length, offset + size);
  let p = offset;

  for (let n = 0; p + 4 <= end && n < MAX_INFO_RECORDS; n++) {
    const format = b[p] as number;
    const attribute = b[p + 1] as number;
    const length = b.readUInt16LE(p + 2);

    // Format 4 carries `length` payload bytes; the other formats seen (1, 3) carry nothing after the 4-byte header.
    if (format === 4) {
      if (p + 4 + length > end) break;
      if (attribute === EIATTR_REGCOUNT && length === 8) out.set(b.readUInt32LE(p + 4), b.readUInt32LE(p + 8));
      p += 4 + length;
    } else {
      p += 4;
    }
  }

  return out;
}

/** `_Z5saxpyifPKfPf` -> `saxpy`; anything with a namespace, template or other prefix -> null. */
export function simpleIdentifier(name: string): string | null {
  const m = /^_Z(\d{1,3})([A-Za-z_]\w*)$/.exec(name);

  if (m === null) return null;

  const length = Number(m[1]);
  const rest = m[2] as string;

  return length > 0 && length <= rest.length ? rest.slice(0, length) : null;
}

export function parseCubin(b: Buffer): CubinInfo {
  const info: CubinInfo = { archFlag: null, sectionCount: 0, kernels: [], warnings: [], truncated: false };

  if (!isCubin(b)) {
    info.warnings.push('not a CUDA ELF (64-bit little-endian, e_machine 190)');

    return info;
  }

  try {
    info.archFlag = smOfFlags(b.readUInt32LE(0x30), b[7] as number);

    const shoff = Number(b.readBigUInt64LE(0x28));
    const entsize = b.readUInt16LE(0x3a);
    let count = b.readUInt16LE(0x3c);
    const strIndex = b.readUInt16LE(0x3e);

    if (entsize !== 64 || shoff <= 0 || shoff + count * 64 > b.length) {
      info.warnings.push('the section header table is missing or runs past the file');

      return info;
    }
    if (count > MAX_SECTIONS) {
      count = MAX_SECTIONS;
      info.truncated = true;
      info.warnings.push(`more than ${MAX_SECTIONS} sections: the rest are not read`);
    }

    info.sectionCount = count;

    type Sec = { name: string; type: number; offset: number; size: number; link: number; info: number };
    const secs: Sec[] = [];
    const header = (i: number) => shoff + i * 64;
    const strOffset = strIndex < count ? Number(b.readBigUInt64LE(header(strIndex) + 24)) : 0;
    const strSize = strIndex < count ? Number(b.readBigUInt64LE(header(strIndex) + 32)) : 0;

    for (let i = 0; i < count; i++) {
      const h = header(i);

      secs.push({
        name: cstr(b, strOffset + b.readUInt32LE(h), Math.min(b.length, strOffset + strSize)),
        type: b.readUInt32LE(h + 4),
        offset: Number(b.readBigUInt64LE(h + 24)),
        size: Number(b.readBigUInt64LE(h + 32)),
        link: b.readUInt32LE(h + 40),
        info: b.readUInt32LE(h + 44),
      });
    }

    const sizeOf = new Map<string, number>();

    for (const s of secs) if (!sizeOf.has(s.name)) sizeOf.set(s.name, s.size);

    const symtab = secs.find(s => s.type === 2);
    const globalInfo = secs.find(s => s.name === '.nv.info');
    const regs = globalInfo !== undefined && globalInfo.offset + globalInfo.size <= b.length ? regCounts(b, globalInfo.offset, globalInfo.size) : new Map<number, number>();
    const strtab = symtab === undefined ? undefined : secs[symtab.link];

    if (symtab === undefined || strtab === undefined) {
      info.warnings.push('no symbol table: no kernels are listed');

      return info;
    }
    if (symtab.offset + symtab.size > b.length || strtab.offset + strtab.size > b.length) {
      info.warnings.push('the symbol table runs past the file');

      return info;
    }

    const strEnd = strtab.offset + strtab.size;
    const total = Math.min(Math.floor(symtab.size / 24), MAX_SYMBOLS);

    if (Math.floor(symtab.size / 24) > MAX_SYMBOLS) {
      info.truncated = true;
      info.warnings.push(`more than ${MAX_SYMBOLS} symbols: the rest are not read`);
    }

    for (let i = 0; i < total; i++) {
      const at = symtab.offset + i * 24;
      const type = b[at + 4]! & 0xf;
      const bind = b[at + 4]! >> 4;

      if (type !== 2 || bind !== 1) continue;
      if (info.kernels.length >= MAX_KERNELS) {
        info.truncated = true;
        info.warnings.push(`more than ${MAX_KERNELS} functions: the rest are not read`);
        break;
      }

      const name = cstr(b, strtab.offset + b.readUInt32LE(at), strEnd);
      const sec = secs[b.readUInt16LE(at + 6)];
      const code = sec !== undefined && sec.name.startsWith('.text.') ? sec : undefined;
      const archNumber = info.archFlag ?? 0;

      info.kernels.push({
        name,
        identifier: simpleIdentifier(name),
        isEntry: ((b[at + 5] as number) & STO_CUDA_ENTRY) !== 0,
        codeBytes: code?.size ?? null,
        instructionEstimate: code !== undefined && archNumber >= 70 ? Math.floor(code.size / 16) : null,
        registers: regs.get(i) ?? null,
        constantBytes: sizeOf.get(`.nv.constant0.${name}`) ?? null,
        sharedBytes: sizeOf.get(`.nv.shared.${name}`) ?? null,
        localBytes: sizeOf.get(`.nv.local.${name}`) ?? null,
      });
    }
  } catch (err) {
    info.warnings.push(`cubin parse stopped: ${err instanceof RangeError ? 'out-of-bounds read' : String(err).slice(0, 100)}`);
  }

  return info;
}
