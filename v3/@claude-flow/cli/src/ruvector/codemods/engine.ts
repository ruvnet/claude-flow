/**
 * Deterministic Codemod Engine (ADR-143)
 *
 * Truly $0, no-LLM Tier-1 code transforms. Uses the TypeScript compiler API to
 * locate exact AST nodes, then applies formatting-preserving text-range edits to
 * the original source string (we never re-print the whole file, so comments and
 * formatting survive).
 *
 * Only intents that can be transformed *deterministically and safely* live here.
 * Intents that need inference or judgement (add-types, add-error-handling,
 * async-await) are intentionally NOT codemods — they route to a model. See
 * ADR-143 for the rationale.
 *
 * @module ruvector/codemods/engine
 */

import ts from 'typescript';
import { buildReassignmentResolver } from './scope-analysis.js';

export type CodemodIntent = 'var-to-const' | 'remove-console' | 'add-logging';

/** Intents this engine can apply deterministically with $0 cost. */
export const DETERMINISTIC_CODEMOD_INTENTS: readonly CodemodIntent[] = [
  'var-to-const',
  'remove-console',
  'add-logging',
] as const;

/** Intents recognised by the router but NOT safe as deterministic codemods. */
export const MODEL_ROUTED_INTENTS: readonly string[] = [
  'add-types',
  'add-error-handling',
  'async-await',
] as const;

export type CodemodLanguage = 'javascript' | 'typescript' | 'jsx' | 'tsx';

export interface CodemodResult {
  intent: CodemodIntent;
  success: boolean;
  /** true if the output differs from the input. */
  changed: boolean;
  output: string;
  /** number of discrete edit sites applied. */
  edits: number;
  language: CodemodLanguage;
  reason?: string;
}

interface TextEdit {
  start: number;
  end: number;
  replacement: string;
}

export function isDeterministicCodemod(intent: string): intent is CodemodIntent {
  return (DETERMINISTIC_CODEMOD_INTENTS as readonly string[]).includes(intent);
}

// ============================================================================
// Parsing & edit application
// ============================================================================

function scriptKind(language: CodemodLanguage): ts.ScriptKind {
  switch (language) {
    case 'typescript':
      return ts.ScriptKind.TS;
    case 'tsx':
      return ts.ScriptKind.TSX;
    case 'jsx':
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.JS;
  }
}

function parse(code: string, language: CodemodLanguage): ts.SourceFile {
  return ts.createSourceFile(
    `codemod-input.${language}`,
    code,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind(language),
  );
}

function parseDiagnosticCount(sf: ts.SourceFile): number {
  // parseDiagnostics is internal but stable; guard so a missing field never throws.
  return (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length ?? 0;
}

/** Apply edits to the original source, right-to-left so offsets stay valid. */
function applyEdits(code: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}

function lineStartOffset(code: string, pos: number): number {
  let i = pos;
  while (i > 0 && code[i - 1] !== '\n') i--;
  return i;
}

function leadingIndent(code: string, lineStart: number): string {
  let i = lineStart;
  while (i < code.length && (code[i] === ' ' || code[i] === '\t')) i++;
  return code.slice(lineStart, i);
}

// ============================================================================
// var-to-const  (scope-aware reassignment analysis — see scope-analysis.ts)
// ============================================================================

function isVarList(list: ts.VariableDeclarationList): boolean {
  return !(list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const));
}

function collectBindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) collectBindingNames(el.name, out);
  }
}

function varToConstEdits(code: string, sf: ts.SourceFile): TextEdit[] {
  const resolver = buildReassignmentResolver(sf);
  const edits: TextEdit[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclarationList(node) && isVarList(node)) {
      const names = new Set<string>();
      for (const decl of node.declarations) collectBindingNames(decl.name, names);
      // `const` only when no declared binding is reassigned *within its own scope*.
      const anyReassigned = [...names].some((n) => resolver.isReassigned(n, node));
      const keyword = anyReassigned ? 'let' : 'const';

      // The `var` keyword is the first token of the declaration list.
      const start = node.getStart(sf);
      // Only rewrite when the literal text really is `var` (guards against odd trivia).
      if (code.slice(start, start + 3) === 'var') {
        edits.push({ start, end: start + 3, replacement: keyword });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return edits;
}

// ============================================================================
// remove-console
// ============================================================================

function rootIdentifier(expr: ts.Expression): ts.Identifier | undefined {
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
    cur = cur.expression;
  }
  return ts.isIdentifier(cur) ? cur : undefined;
}

function isConsoleCallStatement(stmt: ts.Statement): boolean {
  if (!ts.isExpressionStatement(stmt)) return false;
  let expr: ts.Expression = stmt.expression;
  // unwrap `void console.log(x)` and awaited/comma forms defensively
  if (ts.isCallExpression(expr)) {
    const root = rootIdentifier(expr.expression);
    return !!root && root.text === 'console';
  }
  return false;
}

function removeConsoleEdits(code: string, sf: ts.SourceFile): TextEdit[] {
  const edits: TextEdit[] = [];

  const visit = (node: ts.Node): void => {
    if (isConsoleCallStatement(node as ts.Statement)) {
      const stmt = node as ts.Statement;
      const start = stmt.getStart(sf);
      const end = stmt.getEnd();
      const ls = lineStartOffset(code, start);
      const beforeIsBlank = code.slice(ls, start).trim() === '';

      // Is the rest of the line after the statement only whitespace?
      let lineEnd = end;
      while (lineEnd < code.length && code[lineEnd] !== '\n') lineEnd++;
      const afterIsBlank = code.slice(end, lineEnd).trim() === '';

      if (beforeIsBlank && afterIsBlank) {
        // Statement owns its line(s): drop the whole line incl. trailing newline.
        const dropEnd = lineEnd < code.length ? lineEnd + 1 : lineEnd;
        edits.push({ start: ls, end: dropEnd, replacement: '' });
      } else {
        // Inline with other code: remove just the statement, tidy one trailing space.
        let e = end;
        if (code[e] === ' ') e++;
        edits.push({ start, end: e, replacement: '' });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return edits;
}

// ============================================================================
// add-logging
// ============================================================================

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

function isFunctionLikeWithBlock(node: ts.Node): node is FunctionLike {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)) &&
    !!node.body &&
    ts.isBlock(node.body)
  );
}

function functionName(node: FunctionLike): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)) &&
    node.name &&
    (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
  ) {
    return node.name.text;
  }
  // function expression / arrow assigned to a variable or property
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return 'anonymous';
}

function alreadyLogsEntry(body: ts.Block, name: string): boolean {
  const first = body.statements[0];
  if (!first || !isConsoleCallStatement(first)) return false;
  const text = first.getText();
  return text.includes(`'${name} called'`) || text.includes(`"${name} called"`);
}

function addLoggingEdits(code: string, sf: ts.SourceFile): TextEdit[] {
  const edits: TextEdit[] = [];

  const visit = (node: ts.Node): void => {
    if (isFunctionLikeWithBlock(node)) {
      const body = node.body as ts.Block;
      const name = functionName(node);
      if (!alreadyLogsEntry(body, name)) {
        const braceOffset = body.getStart(sf); // position of '{'
        const headerLineStart = lineStartOffset(code, node.getStart(sf));
        const indent = leadingIndent(code, headerLineStart);
        const bodyIndent = indent + '  ';
        const insertion = `\n${bodyIndent}console.log(${JSON.stringify(`${name} called`)});`;
        edits.push({ start: braceOffset + 1, end: braceOffset + 1, replacement: insertion });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return edits;
}

// ============================================================================
// Public API
// ============================================================================

const TRANSFORMS: Record<CodemodIntent, (code: string, sf: ts.SourceFile) => TextEdit[]> = {
  'var-to-const': varToConstEdits,
  'remove-console': removeConsoleEdits,
  'add-logging': addLoggingEdits,
};

export interface ApplyCodemodOptions {
  language?: CodemodLanguage;
}

/**
 * Apply a deterministic codemod to a source string.
 *
 * Returns the transformed source plus metadata. Never throws on malformed input
 * — it reports `success: false` with a reason instead. Guarantees the output
 * does not introduce new parse errors (otherwise it returns the input unchanged).
 */
export function applyCodemod(
  intent: string,
  code: string,
  opts: ApplyCodemodOptions = {},
): CodemodResult {
  const language: CodemodLanguage = opts.language ?? 'typescript';

  if (!isDeterministicCodemod(intent)) {
    return {
      intent: intent as CodemodIntent,
      success: false,
      changed: false,
      output: code,
      edits: 0,
      language,
      reason: `"${intent}" is not a deterministic codemod — route it to a model (Tier 2/3).`,
    };
  }

  let sf: ts.SourceFile;
  try {
    sf = parse(code, language);
  } catch (err) {
    return {
      intent,
      success: false,
      changed: false,
      output: code,
      edits: 0,
      language,
      reason: `parse failed: ${(err as Error).message}`,
    };
  }

  const beforeDiagnostics = parseDiagnosticCount(sf);
  const edits = TRANSFORMS[intent](code, sf);

  if (edits.length === 0) {
    return { intent, success: true, changed: false, output: code, edits: 0, language };
  }

  const output = applyEdits(code, edits);

  // Safety net: never hand back source that parses worse than the input.
  const afterDiagnostics = parseDiagnosticCount(parse(output, language));
  if (afterDiagnostics > beforeDiagnostics) {
    return {
      intent,
      success: false,
      changed: false,
      output: code,
      edits: 0,
      language,
      reason: 'transform would introduce parse errors — aborted (input returned unchanged).',
    };
  }

  return { intent, success: true, changed: true, output, edits: edits.length, language };
}
