/**
 * ruRE Phase 1 — static analysis via the TypeScript compiler API (ADR-0002).
 *
 * Parses JS/MJS/CJS/TS/TSX source into an AST and inspects it. This module
 * only reads and inspects; it never calls eval, vm, child_process, or a
 * dynamic require on analyzed content (ADR-0001 "parses, never executes").
 *
 * The `typescript` package is loaded lazily (not as a top-level import):
 * mcp-tools/rure-tools.ts is registered into every CLI invocation's tool
 * set via mcp-client.ts, so a static `import ts from 'typescript'` here
 * would load the full compiler into memory on every `ruflo` command, not
 * just the ones that use ruRE. Same reasoning as aidefence-gate.ts's lazy
 * load, and the same failure shape as the #2561 cold-start regression.
 */

import type * as TS from 'typescript';

type TsModule = typeof import('typescript');

let tsModulePromise: Promise<TsModule> | null = null;
function loadTs(): Promise<TsModule> {
  tsModulePromise ??= import('typescript');
  return tsModulePromise;
}

export interface Evidence {
  file: string;
  /** 1-indexed, inclusive. */
  lineStart: number;
  lineEnd: number;
}

export interface ImportRecord {
  source: string;
  names: string[];
  evidence: Evidence;
}

export interface ExportRecord {
  name: string;
  evidence: Evidence;
}

export interface ElectronBoundaryHit {
  kind: 'require-electron' | 'ipcMain' | 'ipcRenderer' | 'contextBridge' | 'nodeIntegration-flag';
  detail: string;
  evidence: Evidence;
}

export interface ModuleAnalysis {
  file: string;
  imports: ImportRecord[];
  exports: ExportRecord[];
  electronBoundaries: ElectronBoundaryHit[];
  /** Raw text snippets this module's analysis quoted, for the AIDefence gate to scan. */
  rawSnippets: string[];
}

const ANALYZABLE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);

/** No `typescript` dependency — pure extension check, safe to call eagerly. */
export function isAnalyzableFile(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  return ANALYZABLE_EXT.has(path.slice(dot));
}

function scriptKindFor(ts: TsModule, path: string): TS.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (path.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function evidenceFor(sf: TS.SourceFile, node: TS.Node, file: string): Evidence {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  return { file, lineStart: start, lineEnd: end };
}

function textOf(node: TS.Node): string {
  return node.getText();
}

/** Parses one file's source text into a structural analysis. Never executes it. */
export async function analyzeModuleSource(file: string, sourceText: string): Promise<ModuleAnalysis> {
  const ts = await loadTs();
  const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(ts, file));
  const imports: ImportRecord[] = [];
  const exports: ExportRecord[] = [];
  const electronBoundaries: ElectronBoundaryHit[] = [];
  const rawSnippets: string[] = [];

  const pushSnippet = (n: TS.Node) => {
    const t = textOf(n);
    if (t) rawSnippets.push(t);
  };

  function visit(node: TS.Node): void {
    // ESM: import ... from "x"
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const source = node.moduleSpecifier.text;
      const names: string[] = [];
      const bindings = node.importClause?.namedBindings;
      if (node.importClause?.name) names.push(node.importClause.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) names.push(el.name.text);
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        names.push(`* as ${bindings.name.text}`);
      }
      imports.push({ source, names, evidence: evidenceFor(sf, node, file) });
      pushSnippet(node);
      if (source === 'electron') {
        electronBoundaries.push({
          kind: 'require-electron',
          detail: `import from "electron": ${names.join(', ') || '(side-effect only)'}`,
          evidence: evidenceFor(sf, node, file),
        });
      }
    }

    // ESM: export ... (named, default, declarations)
    if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          exports.push({ name: el.name.text, evidence: evidenceFor(sf, node, file) });
        }
      }
      pushSnippet(node);
    }
    if (ts.isExportAssignment(node)) {
      exports.push({ name: 'default', evidence: evidenceFor(sf, node, file) });
      pushSnippet(node);
    }
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableStatement(node)) &&
      hasExportModifier(ts, node)
    ) {
      const name = exportedNameOf(ts, node);
      if (name) exports.push({ name, evidence: evidenceFor(sf, node, file) });
    }

    // CJS: require("x") / require("electron")
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        const source = arg.text;
        imports.push({ source, names: [], evidence: evidenceFor(sf, node, file) });
        pushSnippet(node);
        if (source === 'electron') {
          electronBoundaries.push({
            kind: 'require-electron',
            detail: `require("electron")`,
            evidence: evidenceFor(sf, node, file),
          });
        }
      }
    }

    // Electron process-boundary signals: ipcMain / ipcRenderer / contextBridge usage,
    // and the nodeIntegration webPreferences flag (renderer-trust indicator).
    if (ts.isPropertyAccessExpression(node) || ts.isIdentifier(node)) {
      const text = ts.isIdentifier(node) ? node.text : node.name.text;
      if (text === 'ipcMain' || text === 'ipcRenderer' || text === 'contextBridge') {
        electronBoundaries.push({
          kind: text as ElectronBoundaryHit['kind'],
          detail: textOf(node).slice(0, 160),
          evidence: evidenceFor(sf, node, file),
        });
        pushSnippet(node);
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'nodeIntegration'
    ) {
      electronBoundaries.push({
        kind: 'nodeIntegration-flag',
        detail: textOf(node).slice(0, 160),
        evidence: evidenceFor(sf, node, file),
      });
      pushSnippet(node);
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return { file, imports, exports, electronBoundaries, rawSnippets };
}

function hasExportModifier(ts: TsModule, node: TS.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function exportedNameOf(
  ts: TsModule,
  node: TS.FunctionDeclaration | TS.ClassDeclaration | TS.VariableStatement,
): string | null {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
    return node.name?.text ?? null;
  }
  const first = node.declarationList.declarations[0];
  return first && ts.isIdentifier(first.name) ? first.name.text : null;
}
