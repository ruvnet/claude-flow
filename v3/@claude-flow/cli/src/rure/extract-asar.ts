/**
 * ruRE Phase 1 — ASAR extraction with resource caps (ADR-0002).
 *
 * @electron/asar already guards path traversal internally
 * (lib/path-validation.ts's ensureWithin); this module adds the
 * decompression-bomb guard ADR-0002 requires, by reading the archive header
 * (no extraction) and summing declared sizes BEFORE calling extractAll.
 *
 * ruRE never writes into a path derived from archive entry names — the
 * destination is always a ruRE-owned scratch directory.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface AsarExtractLimits {
  /** Maximum total declared uncompressed size, in bytes. */
  maxTotalBytes: number;
  /** Maximum number of files. */
  maxFileCount: number;
}

export const DEFAULT_ASAR_LIMITS: AsarExtractLimits = {
  maxTotalBytes: 512 * 1024 * 1024, // 512 MiB
  maxFileCount: 50_000,
};

export interface AsarExtractResult {
  unpackedPath: string;
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
  reason?: string;
}

interface DirRecordLike {
  files?: Record<string, unknown>;
}
interface FileRecordLike {
  size?: number;
  link?: string;
}

function walkHeader(node: unknown, acc: { files: number; bytes: number }): void {
  if (!node || typeof node !== 'object') return;
  const dir = node as DirRecordLike;
  if (dir.files && typeof dir.files === 'object') {
    for (const child of Object.values(dir.files)) {
      const rec = child as FileRecordLike & DirRecordLike;
      if (rec.files) {
        walkHeader(rec, acc);
      } else if (typeof rec.size === 'number') {
        acc.files += 1;
        acc.bytes += rec.size;
      }
    }
  }
}

/**
 * Extracts an .asar archive to a fresh ruRE-owned scratch directory, after
 * verifying the archive's declared size/file-count against `limits`. Never
 * extracts (even partially) when the pre-check fails — `truncated: true`
 * with no files written, not a partial extraction passed off as complete.
 */
export async function extractAsarWithCaps(
  archivePath: string,
  limits: AsarExtractLimits = DEFAULT_ASAR_LIMITS,
): Promise<AsarExtractResult> {
  const asar = await import('@electron/asar');
  const { header } = asar.getRawHeader(archivePath);

  const acc = { files: 0, bytes: 0 };
  walkHeader(header, acc);

  if (acc.files > limits.maxFileCount) {
    return {
      unpackedPath: '',
      fileCount: acc.files,
      totalBytes: acc.bytes,
      truncated: true,
      reason: `archive declares ${acc.files} files, exceeding the ${limits.maxFileCount}-file cap`,
    };
  }
  if (acc.bytes > limits.maxTotalBytes) {
    return {
      unpackedPath: '',
      fileCount: acc.files,
      totalBytes: acc.bytes,
      truncated: true,
      reason: `archive declares ${acc.bytes} bytes, exceeding the ${limits.maxTotalBytes}-byte cap`,
    };
  }

  const scratchRoot = mkdtempSync(join(tmpdir(), 'ruflo-rure-asar-'));
  const unpackedPath = join(scratchRoot, 'unpacked');
  asar.extractAll(archivePath, unpackedPath);

  return { unpackedPath, fileCount: acc.files, totalBytes: acc.bytes, truncated: false };
}
