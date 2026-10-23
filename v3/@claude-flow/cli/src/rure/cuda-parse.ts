/**
 * ruRE Phase 5 — CUDA fatbin and cubin static analysis (ADR-0006). One entry point: `analyzeCuda(bytes)` decides what it was handed from
 * the bytes (a host ELF or PE with a `.nv_fatbin` section, a standalone fatbin, a standalone cubin, or PTX text), walks the containers,
 * decompresses what may be decompressed under the caps, and returns the inventory: architectures, PTX, kernels and what each costs.
 * Parses, never executes; no CUDA toolkit or driver is touched.
 */
import { parseBinary, MAX_BINARY_BYTES } from './binary-parse.js';
import { defaultZstd, FATBIN_MAGIC, MAX_TOTAL_BYTES, readPayload, walkFatbin, type Compression, type RawEntry, type Zstd } from './cuda-fatbin.js';
import { isCubin, parseCubin, type CubinKernel } from './cuda-cubin.js';
import { looksLikePtx, scanPtx, type PtxInfo } from './cuda-ptx.js';

export { MAX_BINARY_BYTES };

export type CudaSource = 'host' | 'fatbin' | 'cubin' | 'ptx';

export interface CudaEntry {
  index: number;
  container: number;
  kind: 'ptx' | 'cubin' | 'unknown';
  rawKind: number;
  arch: string | null;
  /** Reported raw: its meaning is not documented. */
  version: string;
  flags: string;
  compressed: Compression;
  storedBytes: number;
  /** Bytes after decompression, or null when the payload could not be read. */
  size: number | null;
  read: boolean;
  note?: string;
  objName?: { offset: number; length: number };
}

export interface CudaKernel extends CubinKernel {
  /** The index of the entry (cubin) it was read from, and that entry's architecture. */
  entry: number | null;
  arch: string | null;
}

export interface CudaPtxModule extends PtxInfo {
  entry: number | null;
}

export interface CudaInfo {
  source: CudaSource;
  /** Where the fatbin was in a host file. */
  hostSection: { name: string; offset: number; size: number } | null;
  /** Names in a host file that say it uses CUDA: sections, libraries, driver and runtime imports. */
  hostSignals: string[];
  containers: number;
  entries: CudaEntry[];
  /** Distinct `sm_NN` of the cubins and of the PTX, sorted. */
  cubinArchs: string[];
  ptxArchs: string[];
  kernels: CudaKernel[];
  ptx: CudaPtxModule[];
  warnings: string[];
  truncated: boolean;
}

export interface CudaOptions {
  includePtx?: boolean;
  /** Overridable so a Node without zstd can be tested; null means "this runtime cannot read zstd". */
  zstd?: Zstd | null;
}

const FATBIN_SECTIONS = new Set(['.nv_fatbin', '.nv_fatb', '__nv_fatbin']);
const SIGNAL_SECTION = /^(?:\.nv|__nv|\.nvFatBin)/;
const SIGNAL_LIBRARY = /cuda|cudart|cublas|cudnn|cufft|curand|cusparse|nvrtc|nvcuda|nvml/i;
const SIGNAL_IMPORT = /^(?:cu[A-Z]\w*|__cuda\w+|__cudaRegister\w+)$/;
const SIGNAL_MAX = 24;

const archOf = (n: number): string | null => (n > 0 && n < 1000 ? `sm_${n}` : null);
const kindName = (k: number): CudaEntry['kind'] => (k === 1 ? 'ptx' : k === 2 ? 'cubin' : 'unknown');

const empty = (source: CudaSource): CudaInfo => ({ source, hostSection: null, hostSignals: [], containers: 0, entries: [], cubinArchs: [], ptxArchs: [], kernels: [], ptx: [], warnings: [], truncated: false });

/** Reads the entries of one or more fatbin containers found in b[start, end) and fills `info`. */
function readFatbin(b: Buffer, start: number, end: number, info: CudaInfo, opts: CudaOptions): void {
  const zstd = opts.zstd === undefined ? defaultZstd : opts.zstd;
  const budget = { left: MAX_TOTAL_BYTES };
  const walked = walkFatbin(b, start, end, info.warnings);

  info.containers = walked.containers;
  info.truncated = info.truncated || walked.truncated;

  if (walked.containers === 0) info.warnings.push('no fatbin container (magic 0xBA55ED50) at the start of the section');

  for (const raw of walked.entries) info.entries.push(readEntry(b, raw, zstd, budget, info, opts));

  const archs = (kind: CudaEntry['kind']) => [...new Set(info.entries.filter(e => e.kind === kind && e.arch !== null).map(e => e.arch as string))].sort();

  info.cubinArchs = archs('cubin');
  info.ptxArchs = archs('ptx');
}

function readEntry(b: Buffer, raw: RawEntry, zstd: Zstd | null, budget: { left: number }, info: CudaInfo, opts: CudaOptions): CudaEntry {
  const kind = kindName(raw.kind);
  const payload = readPayload(b, raw, zstd, budget);
  const arch = archOf(raw.archNumber);
  const entry: CudaEntry = {
    index: raw.index,
    container: raw.container,
    kind,
    rawKind: raw.kind,
    arch,
    version: `0x${raw.version.toString(16)}`,
    flags: `0x${raw.flags.toString(16)}`,
    compressed: payload.compressed,
    storedBytes: raw.compressedSize > 0 ? raw.compressedSize : raw.payloadLength,
    size: payload.data === null ? null : payload.data.length,
    read: payload.data !== null,
    ...(payload.note !== undefined && { note: payload.note }),
    ...(raw.objNameOffset !== 0 || raw.objNameLen !== 0 ? { objName: { offset: raw.objNameOffset, length: raw.objNameLen } } : {}),
  };

  if (payload.data === null) return entry;

  if (kind === 'cubin') {
    if (!isCubin(payload.data)) {
      entry.read = false;
      entry.note = 'a cubin entry whose payload is not a CUDA ELF: not read';

      return entry;
    }

    const cubin = parseCubin(payload.data);

    info.warnings.push(...cubin.warnings.map(w => `entry ${raw.index}: ${w}`));
    info.truncated = info.truncated || cubin.truncated;

    if (arch !== null && cubin.archFlag !== null && cubin.archFlag !== 0 && cubin.archFlag !== raw.archNumber) {
      info.warnings.push(`entry ${raw.index}: the entry header says ${arch}, the cubin's e_flags say sm_${cubin.archFlag}`);
    }

    for (const k of cubin.kernels) info.kernels.push({ ...k, entry: raw.index, arch });
  } else if (kind === 'ptx') {
    const text = payload.data.toString('latin1').replace(/\0+$/, '');

    info.ptx.push({ ...scanPtx(text, opts.includePtx === true), entry: raw.index });
  }

  return entry;
}

/** Names in a host binary that say it is a CUDA program (never anything but its own names; nothing is loaded). */
function hostSignalsOf(host: ReturnType<typeof parseBinary>): string[] {
  const out = [
    ...host.sections.map(s => s.name).filter(n => SIGNAL_SECTION.test(n)),
    ...host.libraries.filter(n => SIGNAL_LIBRARY.test(n)),
    ...host.imports.filter(n => SIGNAL_IMPORT.test(n)).slice(0, 12),
  ];

  return [...new Set(out)].slice(0, SIGNAL_MAX);
}

/** What the bytes are and what is in them. Never throws on hostile input: a failure is a warning. */
export function analyzeCuda(b: Buffer, opts: CudaOptions = {}): CudaInfo {
  if (b.length >= 4 && b.readUInt32LE(0) === FATBIN_MAGIC) {
    const info = empty('fatbin');

    readFatbin(b, 0, b.length, info, opts);

    return info;
  }

  if (isCubin(b)) {
    const info = empty('cubin');
    const cubin = parseCubin(b);
    const arch = cubin.archFlag === null ? null : archOf(cubin.archFlag);

    info.warnings.push(...cubin.warnings);
    info.truncated = cubin.truncated;
    info.kernels = cubin.kernels.map(k => ({ ...k, entry: null, arch }));
    info.cubinArchs = arch === null ? [] : [arch];

    return info;
  }

  if (looksLikePtx(b)) {
    const info = empty('ptx');
    const ptx = scanPtx(b.toString('latin1'), opts.includePtx === true);

    info.ptx = [{ ...ptx, entry: null }];
    info.ptxArchs = ptx.target === null ? [] : [ptx.target];

    return info;
  }

  const info = empty('host');
  const host = parseBinary(b);

  info.warnings.push(...host.warnings);
  info.hostSignals = hostSignalsOf(host);

  const section = host.sections.find(s => FATBIN_SECTIONS.has(s.name));

  if (section === undefined) {
    info.warnings.push(`no .nv_fatbin section: this does not look like a CUDA program (format ${host.format})`);

    return info;
  }

  info.hostSection = { name: section.name, offset: section.offset, size: section.size };

  if (section.offset < 0 || section.size <= 0 || section.offset + section.size > b.length) {
    info.warnings.push('the .nv_fatbin section runs past the file: not read');

    return info;
  }

  readFatbin(b, section.offset, section.offset + section.size, info, opts);

  return info;
}
