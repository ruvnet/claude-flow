/**
 * AST symbolic rule corpus for `PluginPublishScanner` (ADR-320 Part A, Stage 1).
 *
 * Split from publish-scanner.ts to keep both files under the repo's 500-line
 * limit (v3/CLAUDE.md). Pure, deterministic pattern matching over a
 * TypeScript-compiler AST — no model call, mirroring the symbolic half of
 * arXiv:2603.27204's neuro-symbolic pair.
 *
 * Reference: ADR-320 Part A, arXiv:2605.14460 (SCH Table 3 attack family).
 */

import * as ts from 'typescript';
import type { ScanFinding, ScanFindingCategory } from './publish-scanner.js';

const SECRET_NAME_RE = /^(api[_-]?key|apikey|secret|token|credential|password|passwd|auth[_-]?token)$/i;
const ENV_FILE_RE = /(^|[/\\])\.env(\.|$)/;
const READ_FILE_METHOD_RE = /^(readFileSync|readFile)$/;
const NETWORK_HOSTS = new Set(['http', 'https']);
const NETWORK_METHOD_RE = /^(request|get|post|put|delete|patch)$/;
const EXEC_METHOD_RE = /^(exec|execSync)$/;

/** Fixed confidence weights for the deterministic P1 rule pass (0-1). */
const CONFIDENCE = {
  processEnv: 0.6,
  secretIdentifier: 0.5,
  envFileRead: 0.65,
  exfiltration: 0.6,
  hookUndeclaredLiteral: 0.8,
  hookDynamicName: 0.55,
  eval: 0.9,
  dynamicRequire: 0.85,
  dynamicImport: 0.85,
  unsanitizedExec: 0.8,
} as const;

type Push = (category: ScanFindingCategory, confidence: number) => void;

/** Walk a parsed source file and collect every rule match as a `ScanFinding`. */
export function scanSourceForFindings(
  sourceFile: ts.SourceFile,
  relativeFile: string,
  declaredHooks: ReadonlySet<string>,
): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const push: Push = (category, confidence) => {
    findings.push({ category, file: relativeFile, confidence });
  };

  const visit = (node: ts.Node): void => {
    checkCredentialExtraction(node, push);
    checkExfiltrationCall(node, push);
    checkHookInjection(node, declaredHooks, push);
    checkRcePattern(node, push);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

// ─── helpers ────────────────────────────────────────────────────────────

function isProcessEnvExpr(expr: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'process' &&
    expr.name.text === 'env'
  );
}

function calleeName(callee: ts.Expression): string | undefined {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

function calleeObjectName(callee: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    return callee.expression.text;
  }
  return undefined;
}

// 1. credential-extraction ─────────────────────────────────────────────────

function checkCredentialExtraction(node: ts.Node, push: Push): void {
  if (ts.isPropertyAccessExpression(node) && isProcessEnvExpr(node.expression)) {
    push('credential-extraction', CONFIDENCE.processEnv);
    return;
  }
  if (ts.isElementAccessExpression(node) && isProcessEnvExpr(node.expression)) {
    push('credential-extraction', CONFIDENCE.processEnv);
    return;
  }
  if (ts.isPropertyAccessExpression(node) && SECRET_NAME_RE.test(node.name.text)) {
    push('credential-extraction', CONFIDENCE.secretIdentifier);
    return;
  }
  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression);
    const arg0 = node.arguments[0];
    if (name && READ_FILE_METHOD_RE.test(name) && arg0 && ts.isStringLiteralLike(arg0) && ENV_FILE_RE.test(arg0.text)) {
      push('credential-extraction', CONFIDENCE.envFileRead);
    }
  }
}

// 2. exfiltration-call ───────────────────────────────────────────────────

function checkExfiltrationCall(node: ts.Node, push: Push): void {
  if (!ts.isCallExpression(node)) return;
  const callee = node.expression;

  if (ts.isIdentifier(callee) && (callee.text === 'fetch' || callee.text === 'axios')) {
    push('exfiltration-call', CONFIDENCE.exfiltration);
    return;
  }

  const objName = calleeObjectName(callee);
  const method = calleeName(callee);
  if (!objName || !method) return;

  if (NETWORK_HOSTS.has(objName) && method === 'request') {
    push('exfiltration-call', CONFIDENCE.exfiltration);
    return;
  }
  if (objName === 'axios' && NETWORK_METHOD_RE.test(method)) {
    push('exfiltration-call', CONFIDENCE.exfiltration);
  }
}

// 3. undeclared-hook-injection ───────────────────────────────────────────

function isHookRegistrationCall(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee) && callee.text === 'registerHook') return true;
  return calleeObjectName(callee) === 'hooks' && calleeName(callee) === 'register';
}

function checkHookInjection(node: ts.Node, declaredHooks: ReadonlySet<string>, push: Push): void {
  if (!ts.isCallExpression(node) || !isHookRegistrationCall(node.expression)) return;

  const arg0 = node.arguments[0];
  if (arg0 && ts.isStringLiteralLike(arg0)) {
    if (!declaredHooks.has(arg0.text)) {
      push('undeclared-hook-injection', CONFIDENCE.hookUndeclaredLiteral);
    }
    return;
  }
  // Dynamic hook name: can't be verified against the manifest, so it is
  // flagged (lower confidence than a confirmed-undeclared literal name).
  push('undeclared-hook-injection', CONFIDENCE.hookDynamicName);
}

// 4. rce-pattern ─────────────────────────────────────────────────────────

function checkRcePattern(node: ts.Node, push: Push): void {
  if (!ts.isCallExpression(node)) return;
  const callee = node.expression;

  if (ts.isIdentifier(callee) && callee.text === 'eval') {
    push('rce-pattern', CONFIDENCE.eval);
    return;
  }

  if (ts.isIdentifier(callee) && callee.text === 'require') {
    const arg0 = node.arguments[0];
    if (arg0 && !ts.isStringLiteralLike(arg0)) push('rce-pattern', CONFIDENCE.dynamicRequire);
    return;
  }

  if (callee.kind === ts.SyntaxKind.ImportKeyword) {
    // Dynamic `import(...)` — TypeScript models this as a CallExpression
    // whose `expression` is the bare `import` keyword token.
    const arg0 = node.arguments[0];
    if (arg0 && !ts.isStringLiteralLike(arg0)) push('rce-pattern', CONFIDENCE.dynamicImport);
    return;
  }

  const method = calleeName(callee);
  if (method && EXEC_METHOD_RE.test(method)) {
    const arg0 = node.arguments[0];
    if (arg0 && !ts.isStringLiteralLike(arg0)) push('rce-pattern', CONFIDENCE.unsanitizedExec);
  }
}
