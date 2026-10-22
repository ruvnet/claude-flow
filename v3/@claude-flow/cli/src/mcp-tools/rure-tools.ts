/**
 * ruRE Phase 1 MCP Tools — JS/Electron static analysis.
 *
 * See plugins/ruflo-rure/docs/adrs/0001-scope-and-dual-use-policy.md and
 * 0002-phase1-architecture.md. These tools parse local files; they never
 * execute analyzed code, and all extracted text is routed through the
 * AIDefence gate before being returned to the caller.
 */

import { readFileSync, statSync } from 'node:fs';
import type { MCPTool, MCPToolResult } from './types.js';
import { validatePath, validateText } from './validate-input.js';
import { extractAsarWithCaps, DEFAULT_ASAR_LIMITS } from '../rure/extract-asar.js';
import { analyzeJsApp } from '../rure/analyze-js-app.js';
import { findFeature } from '../rure/find-feature.js';
import { gateWithAIDefence } from '../rure/aidefence-gate.js';
import { parseBinary, extractStrings, MAX_BINARY_BYTES } from '../rure/binary-parse.js';
import { parseDotNet } from '../rure/dotnet-parse.js';
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

/** Screens untrusted extracted text through AIDefence, counting what was redacted. */
class Screener {
  redacted = 0;
  async screen(items: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const item of items) {
      const g = await gateWithAIDefence(item);
      if (g.flagged) this.redacted += 1;
      out.push(g.text);
    }
    return out;
  }
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
  {
    name: 'rure_analyze_binary',
    description:
      'Statically inspect a native ELF, PE, or Mach-O file (ADR-0003): format, architecture, entry point, section layout, linked libraries, and imported/exported symbols, plus optional printable strings. Pure byte parsing under hard caps (128 MiB file, bounded tables); the file is never loaded or executed, and every name and string is AIDefence-screened before return. Use when you need an inventory of what a native binary links against and exposes before deciding where to look next — not for disassembly or decompilation, which this does not do. Malformed headers yield warnings, not errors.',
    category: 'rure',
    tags: ['reverse-engineering', 'binary', 'elf', 'pe', 'macho', 'static-analysis'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to a native binary (ELF, PE, or Mach-O)' },
        includeStrings: { type: 'boolean', description: 'Also return up to 200 printable strings (default false)' },
      },
      required: ['path'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      const v = validatePath(input.path, 'path');
      if (!v.valid) return fail(v.error!);
      try {
        const st = statSync(v.sanitized);
        if (!st.isFile()) return fail('path is not a regular file');
        if (st.size > MAX_BINARY_BYTES) return fail(`file exceeds the ${MAX_BINARY_BYTES}-byte analysis cap`);
        const buf = readFileSync(v.sanitized);
        const info = parseBinary(buf);
        const sc = new Screener();
        const screen = (items: string[]) => sc.screen(items);
        const libraries = await screen(info.libraries);
        const imports = await screen(info.imports);
        const exports = await screen(info.exports);
        let strings: { value: string; offset: number }[] | undefined;
        let stringsTruncated = false;
        if (input.includeStrings === true) {
          const ex = extractStrings(buf);
          stringsTruncated = ex.truncated;
          const gated = await screen(ex.strings.map((s) => s.value));
          strings = ex.strings.map((s, i) => ({ value: gated[i], offset: s.offset }));
        }
        return ok({ ...info, libraries, imports, exports, ...(strings ? { strings, stringsTruncated } : {}), redactedCount: sc.redacted });
      } catch (err) {
        return fail(`binary analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
  {
    name: 'rure_analyze_dotnet',
    description:
      'Inspect a managed .NET assembly (.dll/.exe) from its ECMA-335 metadata (ADR-0004): runtime version, assembly identity, assembly references, type names, method count, P/Invoke native imports (module + function), user-string literals, and entry-point token. Reads metadata only under hard caps; the assembly is never loaded or run, and every name and string is AIDefence-screened before return. Use when you need the dependency and native-call surface of a .NET binary before deciding where to dig deeper — not for IL disassembly or decompilation, which this does not do. A native (non-managed) PE returns isManaged:false.',
    category: 'rure',
    tags: ['reverse-engineering', 'dotnet', 'assembly', 'static-analysis'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to a .NET assembly (.dll or .exe)' },
      },
      required: ['path'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      const v = validatePath(input.path, 'path');
      if (!v.valid) return fail(v.error!);
      try {
        const st = statSync(v.sanitized);
        if (!st.isFile()) return fail('path is not a regular file');
        if (st.size > MAX_BINARY_BYTES) return fail(`file exceeds the ${MAX_BINARY_BYTES}-byte analysis cap`);
        const info = parseDotNet(readFileSync(v.sanitized));
        const sc = new Screener();
        const assembly = info.assembly ? { ...info.assembly, name: (await sc.screen([info.assembly.name]))[0] } : null;
        const refNames = await sc.screen(info.assemblyRefs.map((r) => r.name));
        const types = await sc.screen(info.types);
        const pmods = await sc.screen(info.pinvokes.map((x) => x.module));
        const pfuncs = await sc.screen(info.pinvokes.map((x) => x.function));
        const userStrings = await sc.screen(info.userStrings);
        return ok({
          ...info,
          assembly,
          assemblyRefs: info.assemblyRefs.map((r, i) => ({ ...r, name: refNames[i] })),
          types,
          pinvokes: info.pinvokes.map((_, i) => ({ module: pmods[i], function: pfuncs[i] })),
          userStrings,
          redactedCount: sc.redacted,
        });
      } catch (err) {
        return fail(`dotnet analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
];
