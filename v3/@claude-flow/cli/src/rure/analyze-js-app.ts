/**
 * ruRE Phase 1 — whole-app analysis orchestration (ADR-0002).
 *
 * Walks a directory of JS/Electron source, parses every analyzable file,
 * and aggregates the per-module findings. Parses only; never executes.
 */

import { walkAnalyzableFiles } from './walk-files.js';
import { analyzeModuleSource, type ModuleAnalysis } from './ts-walk.js';

export interface AppAnalysis {
  modules: ModuleAnalysis[];
  filesScanned: number;
  truncated: boolean;
  isElectron: boolean;
  /** Files the parser could not handle (e.g. pathological nesting); their boundaries are NOT reported. */
  skippedFiles: number;
}

export async function analyzeJsApp(root: string): Promise<AppAnalysis> {
  const { files, truncated } = walkAnalyzableFiles(root);
  const modules: ModuleAnalysis[] = [];
  let skippedFiles = 0;

  for (const f of files) {
    try {
      modules.push(await analyzeModuleSource(f.path, f.text));
    } catch {
      // Unparseable file (corrupt source, parser stack overflow) — skip it rather
      // than fail the whole analysis, but count it so the gap is visible.
      skippedFiles += 1;
    }
  }

  const isElectron = modules.some((m) => m.electronBoundaries.length > 0);
  return { modules, filesScanned: files.length, truncated, isElectron, skippedFiles };
}
