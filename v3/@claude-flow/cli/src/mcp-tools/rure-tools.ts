/**
 * ruRE Phase 1 MCP Tools — JS/Electron static analysis.
 *
 * See plugins/ruflo-rure/docs/adrs/0001-scope-and-dual-use-policy.md and
 * 0002-phase1-architecture.md. These tools parse local files; they never
 * execute analyzed code, and all extracted text is routed through the
 * AIDefence gate before being returned to the caller.
 */

import { openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import type { MCPTool, MCPToolResult } from './types.js';
import { validatePath, validateText } from './validate-input.js';
import { extractAsarWithCaps, DEFAULT_ASAR_LIMITS } from '../rure/extract-asar.js';
import { analyzeJsApp } from '../rure/analyze-js-app.js';
import { findFeature } from '../rure/find-feature.js';
import { gateWithAIDefence, type GatedText } from '../rure/aidefence-gate.js';
import { parseBinary, extractStrings, MAX_BINARY_BYTES } from '../rure/binary-parse.js';
import { parseDotNet } from '../rure/dotnet-parse.js';
import { analyzeEvm, parseHex, MAX_EVM_BYTES } from '../rure/evm-parse.js';
import { analyzeCuda } from '../rure/cuda-parse.js';
import { planCuda, MAX_BLOCK_SIZES, MAX_DYNAMIC_SHARED_BYTES } from '../rure/cuda-plan.js';
import type { ModuleAnalysis, Evidence } from '../rure/ts-walk.js';

function fail(error: string): MCPToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ success: false, error }) }], isError: true };
}

function ok(data: Record<string, unknown>): MCPToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...data }) }] };
}

/**
 * Screens untrusted extracted text through AIDefence. Every attacker-derived string in a
 * tool result goes through here (paths, names, literals), results are cached per call, and
 * `screened` reports honestly whether the scanner actually ran on everything.
 */
class Screener {
  redacted = 0;
  unscreened = 0;
  private cache = new Map<string, GatedText>();

  async one(item: string): Promise<string> {
    let g = this.cache.get(item);
    if (!g) {
      g = await gateWithAIDefence(item);
      this.cache.set(item, g);
      if (g.flagged) this.redacted += 1;
      if (!g.gated && item) this.unscreened += 1;
    }
    return g.text;
  }

  async screen(items: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const item of items) out.push(await this.one(item));
    return out;
  }

  get screened(): boolean {
    return this.unscreened === 0;
  }
}

async function screenEvidence(sc: Screener, e: Evidence): Promise<Evidence> {
  return { ...e, file: await sc.one(e.file) };
}

/** Returns a module analysis with every attacker-derived string screened and clipped; raw snippets are dropped. */
async function screenModule(sc: Screener, mod: ModuleAnalysis): Promise<Omit<ModuleAnalysis, 'rawSnippets'>> {
  const imports: ModuleAnalysis['imports'] = [];
  for (const i of mod.imports) {
    imports.push({ source: await sc.one(i.source), names: await sc.screen(i.names), evidence: await screenEvidence(sc, i.evidence) });
  }
  const exports: ModuleAnalysis['exports'] = [];
  for (const e of mod.exports) exports.push({ name: await sc.one(e.name), evidence: await screenEvidence(sc, e.evidence) });
  const electronBoundaries: ModuleAnalysis['electronBoundaries'] = [];
  for (const b of mod.electronBoundaries) {
    electronBoundaries.push({ kind: b.kind, detail: await sc.one(b.detail), evidence: await screenEvidence(sc, b.evidence) });
  }
  return { file: await sc.one(mod.file), imports, exports, electronBoundaries };
}

/** Opens once and checks the size on the same descriptor, so a file swapped after a stat cannot bypass the cap. */
function readCapped(path: string, cap: number): { ok: true; bytes: Buffer } | { ok: false; error: string } {
  const fd = openSync(path, 'r');
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { ok: false, error: 'path is not a regular file' };
    if (st.size > cap) return { ok: false, error: `file exceeds the ${cap}-byte analysis cap` };
    return { ok: true, bytes: readFileSync(fd) };
  } finally {
    closeSync(fd);
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
        const sc = new Screener();
        const modules: Omit<ModuleAnalysis, 'rawSnippets'>[] = [];
        for (const m of analysis.modules) modules.push(await screenModule(sc, m));
        return ok({
          filesScanned: analysis.filesScanned,
          truncated: analysis.truncated,
          skippedFiles: analysis.skippedFiles,
          isElectron: analysis.isElectron,
          modules,
          redactedSnippetCount: sc.redacted,
          screened: sc.screened,
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
        const sc = new Screener();
        const gated: Array<Record<string, unknown>> = [];
        for (const m of result.matches) {
          const before = sc.redacted;
          const snippet = await sc.one(m.snippet);
          gated.push({ ...m, file: await sc.one(m.file), snippet, redacted: sc.redacted > before });
        }
        return ok({
          matches: gated,
          filesScanned: result.filesScanned,
          truncated: result.truncated,
          skippedFiles: result.skippedFiles,
          screened: sc.screened,
        });
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
        const r = readCapped(v.sanitized, MAX_BINARY_BYTES);
        if (!r.ok) return fail(r.error);
        const buf = r.bytes;
        const info = parseBinary(buf);
        const sc = new Screener();
        const libraries = await sc.screen(info.libraries);
        const imports = await sc.screen(info.imports);
        const exports = await sc.screen(info.exports);
        const sectionNames = await sc.screen(info.sections.map((x) => x.name));
        const sections = info.sections.map((x, i) => ({ ...x, name: sectionNames[i] }));
        let strings: { value: string; offset: number }[] | undefined;
        let stringsTruncated = false;
        const warnings = [...info.warnings];
        if (input.includeStrings === true) {
          if (info.format === 'unknown') {
            warnings.push('strings not extracted: file is not a recognized binary format');
          } else {
            const ex = extractStrings(buf);
            stringsTruncated = ex.truncated;
            const gated = await sc.screen(ex.strings.map((x) => x.value));
            strings = ex.strings.map((x, i) => ({ value: gated[i], offset: x.offset }));
          }
        }
        return ok({ ...info, warnings, sections, libraries, imports, exports, ...(strings ? { strings, stringsTruncated } : {}), redactedCount: sc.redacted, screened: sc.screened });
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
        const r = readCapped(v.sanitized, MAX_BINARY_BYTES);
        if (!r.ok) return fail(r.error);
        const info = parseDotNet(r.bytes);
        const sc = new Screener();
        const assembly = info.assembly ? { ...info.assembly, name: await sc.one(info.assembly.name) } : null;
        const refNames = await sc.screen(info.assemblyRefs.map((x) => x.name));
        const types = await sc.screen(info.types);
        const pmods = await sc.screen(info.pinvokes.map((x) => x.module));
        const pfuncs = await sc.screen(info.pinvokes.map((x) => x.function));
        const userStrings = await sc.screen(info.userStrings);
        const runtimeVersion = info.runtimeVersion === null ? null : await sc.one(info.runtimeVersion);
        return ok({
          ...info,
          runtimeVersion,
          assembly,
          assemblyRefs: info.assemblyRefs.map((x, i) => ({ ...x, name: refNames[i] })),
          types,
          pinvokes: info.pinvokes.map((_, i) => ({ module: pmods[i], function: pfuncs[i] })),
          userStrings,
          redactedCount: sc.redacted,
          screened: sc.screened,
        });
      } catch (err) {
        return fail(`dotnet analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
  {
    name: 'rure_analyze_evm',
    description:
      'Statically inventory EVM contract bytecode (ADR-0005): instruction and JUMPDEST counts, function selectors recognized from the dispatcher (with names for a small well-known table only), counts and offsets of hazardous opcodes (SELFDESTRUCT, DELEGATECALL, CALLCODE, CREATE/CREATE2, ORIGIN, CALL, STATICCALL), embedded addresses, event topics, EIP-1167 minimal-proxy detection, compiler metadata, and embedded strings such as revert reasons (AIDefence-screened). Pass bytecode inline as hex, or a path to a file of hex text or raw bytes. Aligned disassembly only: there is no EVM interpreter, no RPC, and no network. Use when you need the exposed surface and risky capabilities of a contract before deeper review; a hazardous opcode is an inventory fact, not a vulnerability finding, and dispatcher detection can miss unusual layouts.',
    category: 'rure',
    tags: ['reverse-engineering', 'evm', 'smart-contract', 'static-analysis'],
    inputSchema: {
      type: 'object',
      properties: {
        bytecode: { type: 'string', description: 'Contract bytecode as hex (0x prefix optional). Provide this or path, not both.' },
        path: { type: 'string', description: 'Absolute path to a file containing hex text or raw bytecode' },
        includeDisassembly: { type: 'boolean', description: 'Also return the first 500 instructions (default false)' },
      },
    },
    handler: async (input): Promise<MCPToolResult> => {
      const hasInline = typeof input.bytecode === 'string' && input.bytecode.length > 0;
      const hasPath = typeof input.path === 'string' && input.path.length > 0;
      if (hasInline === hasPath) return fail('provide exactly one of bytecode or path');
      try {
        let bytes: Buffer;
        if (hasInline) {
          const text = input.bytecode as string;
          if (text.length > MAX_EVM_BYTES * 2 + 2) return fail(`bytecode exceeds the ${MAX_EVM_BYTES}-byte cap`);
          const parsed = parseHex(text);
          if (!parsed.ok) return fail(parsed.error);
          bytes = parsed.bytes;
        } else {
          const v = validatePath(input.path, 'path');
          if (!v.valid) return fail(v.error!);
          const r = readCapped(v.sanitized, MAX_EVM_BYTES * 2 + 64);
          if (!r.ok) return fail(r.error);
          const raw = r.bytes;
          const asText = raw.toString('latin1').trim();
          if (/^(0x)?[0-9a-fA-F\s]+$/.test(asText)) {
            const parsed = parseHex(asText.replace(/\s/g, ''));
            if (!parsed.ok) return fail(parsed.error);
            bytes = parsed.bytes;
          } else if (raw.length <= MAX_EVM_BYTES) {
            bytes = raw;
          } else {
            return fail(`file exceeds the ${MAX_EVM_BYTES}-byte bytecode cap`);
          }
        }
        const info = analyzeEvm(bytes, input.includeDisassembly === true);
        const sc = new Screener();
        const strings = await sc.screen(info.strings);
        return ok({ ...info, strings, redactedCount: sc.redacted, screened: sc.screened });
      } catch (err) {
        return fail(`evm analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
  {
    name: 'rure_analyze_cuda',
    description:
      'Statically inventory the GPU code in a CUDA program (ADR-0006): from a host ELF/PE with a .nv_fatbin section, a standalone fatbin, cubin or PTX file, the fatbin containers and entries (PTX or cubin, target architecture sm_NN, compression: zstd and LZ4 payloads are read under size caps), and per kernel its mangled name, code size, register count, constant/shared/local memory and an instruction estimate; PTX version, target and kernel names. Parses only: no SASS decoding, no CUDA toolkit or driver, nothing is run, and nothing is written. Names from the file are untrusted text and are screened by AIDefence (redactedCount / screened report this). Use when you need the GPU side of a CUDA program (which architectures it targets, whether it ships PTX, which kernels exist and what each costs): rure_analyze_binary alone only shows the .nv_fatbin section names, and grep or strings find kernel names only by chance. Run rure_analyze_binary first when it is not known whether a file holds CUDA code.',
    category: 'rure',
    tags: ['reverse-engineering', 'cuda', 'gpu', 'fatbin', 'ptx', 'static-analysis'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to a CUDA host binary (ELF/PE), a .fatbin, a .cubin or a .ptx file' },
        includePtx: { type: 'boolean', description: 'Also return the PTX text, cut at 64 KiB (default false)' },
      },
      required: ['path'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      const v = validatePath(input.path, 'path');
      if (!v.valid) return fail(v.error!);
      try {
        const r = readCapped(v.sanitized, MAX_BINARY_BYTES);
        if (!r.ok) return fail(r.error);
        const info = analyzeCuda(r.bytes, { includePtx: input.includePtx === true });
        const sc = new Screener();
        const names = await sc.screen(info.kernels.map((k) => k.name));
        const idents = await sc.screen(info.kernels.map((k) => k.identifier ?? ''));
        const kernels = info.kernels.map((k, i) => ({ ...k, name: names[i], identifier: k.identifier === null ? null : idents[i] }));
        const ptx: Record<string, unknown>[] = [];
        for (const m of info.ptx) {
          const entries = await sc.screen(m.entries.map((e) => e.name));
          const functions = await sc.screen(m.functions);
          const text = m.text === undefined ? undefined : await sc.one(m.text);
          ptx.push({ ...m, entries: m.entries.map((e, i) => ({ ...e, name: entries[i] })), functions, ...(text !== undefined && { text }) });
        }
        const hostSignals = await sc.screen(info.hostSignals);
        const hostSection = info.hostSection === null ? null : { ...info.hostSection, name: await sc.one(info.hostSection.name) };
        const entryKernels = kernels.filter((k) => k.isEntry).length;
        return ok({
          ...info,
          hostSection,
          hostSignals,
          kernels,
          ptx,
          summary: { containers: info.containers, entries: info.entries.length, cubins: info.entries.filter((e) => e.kind === 'cubin').length, ptxEntries: info.entries.filter((e) => e.kind === 'ptx').length, kernels: entryKernels, deviceFunctions: kernels.length - entryKernels },
          redactedCount: sc.redacted,
          screened: sc.screened,
        });
      } catch (err) {
        return fail(`cuda analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
  {
    name: 'rure_cuda_launch_plan',
    description:
      'Turn the static CUDA inventory of a program into a plan for measuring it (ADR-501): for each kernel of each architecture, its theoretical occupancy at a set of block sizes (blocks and warps resident per multiprocessor, and which resource sets the limit: registers, shared memory, warps or block slots), the block sizes that reach the most, and flags (local memory, register- or shared-memory-limited). The occupancy model reproduces NVIDIA\'s cuda_occupancy.h on every architecture it tabulates (sm_70, 75, 80, 86, 87, 89, 90, 120); any other architecture gets no figure. With includeHarness it also returns the text of a small CUDA driver-API program you can build to check the numbers on your own GPU and, with arguments you supply, to time launches. Nothing is compiled, loaded or run by this tool, and no text from the analyzed file reaches the harness. Occupancy bounds performance and does not predict it. Names from the file are untrusted and screened by AIDefence. Use when you have a CUDA binary, cubin or fatbin and need to decide which kernels and block sizes are worth benchmarking before running anything: rure_analyze_cuda alone lists registers and memory but not what they allow on a given GPU.',
    category: 'rure',
    tags: ['reverse-engineering', 'cuda', 'gpu', 'occupancy', 'benchmark-plan', 'static-analysis'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to a CUDA host binary (ELF/PE), a .fatbin or a .cubin file' },
        arch: { type: 'string', description: 'Plan only this architecture, for example sm_86 (default: every architecture with compiled code in the file)' },
        blockSizes: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 1024 }, maxItems: MAX_BLOCK_SIZES, description: 'Block sizes to evaluate (default 32, 64, 96, 128, 192, 256, 384, 512, 768, 1024)' },
        dynamicSharedBytes: { type: 'integer', minimum: 0, maximum: MAX_DYNAMIC_SHARED_BYTES, description: 'Dynamic shared memory per block the launch will use; it is not in the file (default 0)' },
        includeHarness: { type: 'boolean', description: 'Also return the text of the occupancy-check / benchmark program (default false)' },
      },
      required: ['path'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      const v = validatePath(input.path, 'path');
      if (!v.valid) return fail(v.error!);
      if (input.arch !== undefined && (typeof input.arch !== 'string' || !/^sm_\d{2,3}$/.test(input.arch))) return fail('arch must look like sm_86');
      if (input.blockSizes !== undefined && !Array.isArray(input.blockSizes)) return fail('blockSizes must be an array of integers');
      if (input.dynamicSharedBytes !== undefined && typeof input.dynamicSharedBytes !== 'number') return fail('dynamicSharedBytes must be an integer');
      try {
        const r = readCapped(v.sanitized, MAX_BINARY_BYTES);
        if (!r.ok) return fail(r.error);
        const info = analyzeCuda(r.bytes, { includePtx: false });
        const sc = new Screener();
        const names = await sc.screen(info.kernels.map((k) => k.name));
        const idents = await sc.screen(info.kernels.map((k) => k.identifier ?? ''));
        const screened = { ...info, kernels: info.kernels.map((k, i) => ({ ...k, name: names[i] as string, identifier: k.identifier === null ? null : (idents[i] as string) })) };
        const plan = planCuda(screened, {
          ...(input.arch !== undefined && { arch: input.arch as string }),
          ...(input.blockSizes !== undefined && { blockSizes: input.blockSizes as number[] }),
          ...(input.dynamicSharedBytes !== undefined && { dynamicSharedBytes: input.dynamicSharedBytes as number }),
          includeHarness: input.includeHarness === true,
        });
        const kernels = plan.archs.reduce((n, a) => n + a.kernels.length, 0);
        return ok({
          source: info.source,
          ...plan,
          summary: { archs: plan.archs.length, kernels },
          warnings: info.warnings,
          redactedCount: sc.redacted,
          screened: sc.screened,
        });
      } catch (err) {
        if (err instanceof RangeError) return fail(err.message);
        return fail(`cuda launch plan failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
];
