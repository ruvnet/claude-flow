/**
 * ruRE Phase 1 — bounded lexical/structural feature search (ADR-0002).
 *
 * Deterministic, auditable: scores files by term overlap between the query
 * and each file's identifiers/strings/comments, plus raw substring hits.
 * Not semantic/LLM-based matching, by design — Phase 1 stays explainable.
 */

import { walkAnalyzableFiles } from './walk-files.js';
import { analyzeModuleSource, type Evidence } from './ts-walk.js';

export interface FeatureMatch {
  file: string;
  lineRange: { start: number; end: number };
  snippet: string;
  score: number;
}

export interface FindFeatureResult {
  matches: FeatureMatch[];
  filesScanned: number;
  truncated: boolean;
  skippedFiles: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function scoreLine(lineLower: string, queryTerms: string[]): number {
  let score = 0;
  for (const term of queryTerms) {
    if (lineLower.includes(term)) score += 1;
  }
  return score;
}

export async function findFeature(root: string, query: string, maxMatches = 10): Promise<FindFeatureResult> {
  const queryTerms = Array.from(new Set(tokenize(query)));
  const { files, truncated } = walkAnalyzableFiles(root);

  const candidates: FeatureMatch[] = [];
  let skippedFiles = 0;

  for (const f of files) {
    const lines = f.text.split('\n');
    // Use the parser for structural signal (imports/exports/electron
    // boundaries contribute to relevance) without executing anything.
    let structuralBoost = 0;
    try {
      const analysis = await analyzeModuleSource(f.path, f.text);
      const names = [
        ...analysis.imports.flatMap((i) => [i.source, ...i.names]),
        ...analysis.exports.map((e) => e.name),
      ].join(' ').toLowerCase();
      structuralBoost = scoreLine(names, queryTerms) * 0.5;
    } catch {
      skippedFiles += 1; // unparseable: lexical score alone still applies
    }

    let bestLine = -1;
    let bestScore = 0;
    for (let i = 0; i < lines.length; i++) {
      const s = scoreLine(lines[i].toLowerCase(), queryTerms);
      if (s > bestScore) {
        bestScore = s;
        bestLine = i;
      }
    }
    const total = bestScore + structuralBoost;
    if (total > 0 && bestLine >= 0) {
      const start = Math.max(0, bestLine - 2);
      const end = Math.min(lines.length - 1, bestLine + 2);
      candidates.push({
        file: f.path,
        lineRange: { start: start + 1, end: end + 1 },
        snippet: lines.slice(start, end + 1).join('\n'),
        score: total,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return { matches: candidates.slice(0, maxMatches), filesScanned: files.length, truncated, skippedFiles };
}

export type { Evidence };
