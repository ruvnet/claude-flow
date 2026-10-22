/**
 * ruRE Phase 1 MCP Tools — JS/Electron static analysis.
 *
 * See plugins/ruflo-rure/docs/adrs/0001-scope-and-dual-use-policy.md and
 * 0002-phase1-architecture.md. These tools parse local files; they never
 * execute analyzed code, and all extracted text is routed through the
 * AIDefence gate before being returned to the caller.
 */

import type { MCPTool, MCPToolResult } from './types.js';
import { validatePath, validateText } from './validate-input.js';
import { extractAsarWithCaps, DEFAULT_ASAR_LIMITS } from '../rure/extract-asar.js';
import { analyzeJsApp } from '../rure/analyze-js-app.js';
import { findFeature } from '../rure/find-feature.js';
import { gateWithAIDefence } from '../rure/aidefence-gate.js';
import type { ModuleAnalysis } from '../rure/ts-walk.js';

function fail(error: string): MCPToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ success: false, error }) }], isError: true };
}

function ok(data: Record<string, unknown>): MCPToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...data }) }] };
}

/** Gates every rawSnippet on a module's analysis, dropping snippets in favor of a flagged count. */
async function gateModule(mod: ModuleAnalysis): Promise<{ module: Omit<ModuleAnalysis, 'rawSnippets'>; redactedCount: number }> {
  let redactedCount = 0;
  for (const snippet of mod.rawSnippets) {
    const gated = await gateWithAIDefence(snippet);
    if (gated.flagged) redactedCount += 1;
  }
  const { rawSnippets, ...rest } = mod;
  return { module: rest, redactedCount };
}

export const rureTools: MCPTool[] = [
  {
    name: 'rure_extract_asar',
    description:
      'Unpack an Electron .asar archive to a scratch directory, under resource caps (max total declared size, max file count) checked from the archive header before any bytes are written. Refuses to partially extract: returns truncated:true with nothing written if the archive exceeds the caps. Use when you need to analyze the JS inside a packaged Electron app and rure_analyze_js_app rejects the .asar path directly.',
    category: 'rure',
    tags: ['reverse-engineering', 'electron', 'asar', 'static-analysis'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the .asar file' },
      },
      required: ['path'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      const v = validatePath(input.path, 'path');
      if (!v.valid) return fail(v.error!);
      try {
        const result = await extractAsarWithCaps(v.sanitized, DEFAULT_ASAR_LIMITS);
        if (result.truncated) {
          return ok({ truncated: true, reason: result.reason, fileCount: result.fileCount, totalBytes: result.totalBytes });
        }
        return ok({
          truncated: false,
          unpackedPath: result.unpackedPath,
          fileCount: result.fileCount,
          totalBytes: result.totalBytes,
        });
      } catch (err) {
        return fail(`asar extraction failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
  {
    name: 'rure_analyze_js_app',
    description:
      'Statically analyze a directory of JavaScript/TypeScript/Electron source: module list, import/export graph, and Electron process-boundary detection (ipcMain/ipcRenderer/contextBridge, require("electron"), nodeIntegration flags). Every finding carries evidence (file + line range), AIDefence-screened before return. Use when you need a structural map of unfamiliar JS/Electron source rather than reading files one at a time — native Read is fine for a single already-identified file, but wrong for discovering the import graph or Electron boundaries across a whole app. Does not accept a .asar path directly — run rure_extract_asar first and pass its unpackedPath.',
    category: 'rure',
    tags: ['reverse-engineering', 'electron', 'javascript', 'static-analysis'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to a directory of extracted JS/Electron source' },
      },
      required: ['path'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      const v = validatePath(input.path, 'path');
      if (!v.valid) return fail(v.error!);
      try {
        const analysis = await analyzeJsApp(v.sanitized);
        const gatedModules = await Promise.all(analysis.modules.map(gateModule));
        return ok({
          filesScanned: analysis.filesScanned,
          truncated: analysis.truncated,
          isElectron: analysis.isElectron,
          modules: gatedModules.map((g) => g.module),
          redactedSnippetCount: gatedModules.reduce((sum, g) => sum + g.redactedCount, 0),
        });
      } catch (err) {
        return fail(`analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
  {
    name: 'rure_find_feature',
    description:
      'Locate where a described feature likely lives in an already-extracted JS/Electron app, using deterministic lexical and structural scoring (not semantic/LLM matching, so results stay explainable). Returns ranked matches with file, line range, a short snippet, and a score, every snippet AIDefence-screened before return. Use when the target app is too large to read file-by-file and you need evidence of where a feature lives before explaining or reimplementing it — grep is fine for an exact known string, but wrong when you only have a plain-language description of the behavior.',
    category: 'rure',
    tags: ['reverse-engineering', 'search', 'static-analysis'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to a directory of extracted JS/Electron source' },
        query: { type: 'string', description: 'Plain-language description of the feature to locate' },
      },
      required: ['path', 'query'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      const v = validatePath(input.path, 'path');
      if (!v.valid) return fail(v.error!);
      const q = validateText(input.query, 'query', 2000);
      if (!q.valid) return fail(q.error!);
      try {
        const result = await findFeature(v.sanitized, q.sanitized);
        const gated = await Promise.all(
          result.matches.map(async (m) => {
            const g = await gateWithAIDefence(m.snippet);
            return { ...m, snippet: g.text, redacted: g.flagged };
          }),
        );
        return ok({ matches: gated, filesScanned: result.filesScanned, truncated: result.truncated });
      } catch (err) {
        return fail(`feature search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
];
