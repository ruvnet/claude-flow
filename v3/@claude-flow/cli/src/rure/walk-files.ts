/**
 * ruRE Phase 1 — bounded directory walk shared by the analyze and
 * find-feature tools. Caps file count and per-file read size so a
 * maliciously or accidentally huge target can't exhaust memory.
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAnalyzableFile } from './ts-walk.js';

export interface WalkLimits {
  maxFiles: number;
  maxFileBytes: number;
}

export const DEFAULT_WALK_LIMITS: WalkLimits = {
  maxFiles: 20_000,
  maxFileBytes: 8 * 1024 * 1024, // 8 MiB per file
};

export interface WalkedFile {
  path: string;
  text: string;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.turbo', '.cache']);

export function walkAnalyzableFiles(root: string, limits: WalkLimits = DEFAULT_WALK_LIMITS): {
  files: WalkedFile[];
  truncated: boolean;
} {
  const files: WalkedFile[] = [];
  let truncated = false;

  function visit(dir: string): void {
    if (truncated || files.length >= limits.maxFiles) {
      truncated = files.length >= limits.maxFiles;
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= limits.maxFiles) {
        truncated = true;
        return;
      }
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        visit(full);
      } else if (st.isFile() && isAnalyzableFile(full)) {
        if (st.size > limits.maxFileBytes) continue; // skip oversized files, don't abort the walk
        try {
          files.push({ path: full, text: readFileSync(full, 'utf8') });
        } catch {
          /* unreadable file, skip */
        }
      }
    }
  }

  visit(root);
  return { files, truncated };
}
