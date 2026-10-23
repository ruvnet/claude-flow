/**
 * ruRE Phase 5 — PTX text (ADR-0006): NVIDIA's virtual ISA. Only a bounded scan for the header directives and the kernel and function
 * names; the text is never interpreted further and never run. The scan reads at most 4 MiB, and every pattern is linear.
 */

export const MAX_PTX_SCAN = 4 * 1024 * 1024;
export const MAX_PTX_TEXT = 64 * 1024;
const MAX_NAMES = 500;
const NAME_MAX = 200;

export interface PtxInfo {
  version: string | null;
  target: string | null;
  addressSize: number | null;
  /** `.entry` kernels with the number of `.param` declarations in their signature. */
  entries: { name: string; params: number }[];
  /** `.func` device functions. */
  functions: string[];
  /** The text itself, only when asked for, cut at MAX_PTX_TEXT. */
  text?: string;
  textTruncated?: boolean;
  scanTruncated: boolean;
}

/** True when the bytes look like PTX source: the first directive is `.version` after comments and blank space. */
export function looksLikePtx(b: Buffer): boolean {
  const head = b.toString('latin1', 0, Math.min(b.length, 8192));

  return /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*\.version\s+\d/.test(head);
}

export function scanPtx(text: string, includeText: boolean): PtxInfo {
  const scanned = text.length > MAX_PTX_SCAN ? text.slice(0, MAX_PTX_SCAN) : text;
  const info: PtxInfo = {
    version: /^\s*\.version\s+(\d+\.\d+)/m.exec(scanned)?.[1] ?? null,
    target: /^\s*\.target\s+([A-Za-z0-9_., ]{1,60}?)\s*(?:\/\/|$)/m.exec(scanned)?.[1]?.trim() ?? null,
    addressSize: Number(/^\s*\.address_size\s+(\d+)/m.exec(scanned)?.[1] ?? NaN) || null,
    entries: [],
    functions: [],
    scanTruncated: text.length > MAX_PTX_SCAN,
  };
  const re = /\.(entry|func)\s+(?:\([^)]{0,200}\)\s*)?([A-Za-z_$%][\w$.%]{0,198})\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(scanned)) !== null && info.entries.length + info.functions.length < MAX_NAMES) {
    const name = (m[2] as string).slice(0, NAME_MAX);

    if (m[1] === 'func') {
      info.functions.push(name);
      continue;
    }

    const close = scanned.indexOf(')', re.lastIndex);
    const signature = scanned.slice(re.lastIndex, close < 0 || close - re.lastIndex > 4096 ? re.lastIndex + 4096 : close);

    info.entries.push({ name, params: (signature.match(/\.param\b/g) ?? []).length });
  }

  if (includeText) {
    info.text = scanned.length > MAX_PTX_TEXT ? scanned.slice(0, MAX_PTX_TEXT) : scanned;
    info.textTruncated = scanned.length > MAX_PTX_TEXT;
  }

  return info;
}
