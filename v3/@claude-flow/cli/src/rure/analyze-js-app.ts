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
}

export function analyzeJsApp(root: string): AppAnalysis {
  const { files, truncated } = walkAnalyzableFiles(root);
  const modules: ModuleAnalysis[] = [];

  for (const f of files) {
    try {
      modules.push(analyzeModuleSource(f.path, f.text));
    } catch {
      // Unparseable file (e.g. truncated/corrupt source) — skip it rather
      // than fail the whole analysis; it simply contributes no findings.
    }
  }

  const isElectron = modules.some((m) => m.electronBoundaries.length > 0);
  return { modules, filesScanned: files.length, truncated, isElectron };
}
