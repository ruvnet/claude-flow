#!/usr/bin/env node
/**
 * Enforce ADR-323 provenance on direct memory writes in plugin source.
 *
 * The audit parses JavaScript and TypeScript with the TypeScript compiler API.
 * It fails when a call whose receiver ends in `memory.store` does not pass an
 * object literal with a top-level `provenance_type` property.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const V3_ROOT = path.dirname(SCRIPT_DIR);
const DEFAULT_PLUGIN_ROOT = path.join(V3_ROOT, 'plugins');
const SOURCE_SUFFIXES = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

function walk(directory, output = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target, output);
    else if (entry.isFile() && SOURCE_SUFFIXES.has(path.extname(entry.name))) output.push(target);
  }
  return output;
}

function scriptKindFor(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.tsx': return ts.ScriptKind.TSX;
    case '.jsx': return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs': return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function staticName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const expression = unwrapExpression(name.expression);
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text;
    }
  }
  return null;
}

function elementName(expression) {
  const argument = expression.argumentExpression && unwrapExpression(expression.argumentExpression);
  if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
    return argument.text;
  }
  return null;
}

function propertyAccessParts(expression) {
  const current = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(current)) {
    return { receiver: current.expression, name: current.name.text };
  }
  if (ts.isElementAccessExpression(current)) {
    return { receiver: current.expression, name: elementName(current) };
  }
  return null;
}

function isMemoryReceiver(expression) {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return current.text === 'memory';
  const access = propertyAccessParts(current);
  return access?.name === 'memory';
}

function isMemoryStoreCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const access = propertyAccessParts(node.expression);
  return access?.name === 'store' && isMemoryReceiver(access.receiver);
}

function hasTopLevelProvenance(objectLiteral) {
  return objectLiteral.properties.some((property) => {
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      return staticName(property.name) === 'provenance_type';
    }
    return false;
  });
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function diagnosticText(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
}

export function auditSource(source, file = '<memory>') {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );

  const parseErrors = sourceFile.parseDiagnostics.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (parseErrors.length > 0) {
    return parseErrors.map((diagnostic) => ({
      file,
      line: diagnostic.start === undefined
        ? 1
        : sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line + 1,
      code: 'SOURCE_PARSE_ERROR',
      detail: diagnosticText(diagnostic),
    }));
  }

  const findings = [];
  const visit = (node) => {
    if (isMemoryStoreCall(node)) {
      const firstArgument = node.arguments[0] && unwrapExpression(node.arguments[0]);
      if (!firstArgument || !ts.isObjectLiteralExpression(firstArgument)) {
        findings.push({
          file,
          line: lineOf(sourceFile, node),
          code: 'NON_LITERAL_STORE_ENTRY',
          detail: 'Plugin memory.store calls must use an inspectable object literal',
        });
      } else if (!hasTopLevelProvenance(firstArgument)) {
        findings.push({
          file,
          line: lineOf(sourceFile, node),
          code: 'MISSING_PROVENANCE_TYPE',
          detail: 'Plugin memory.store object must declare top-level provenance_type',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

export function auditPluginMemoryProvenance(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const findings = [];
  const files = walk(pluginRoot).filter((file) => {
    const normalized = file.split(path.sep).join('/');
    return normalized.includes('/src/')
      && !normalized.includes('/__tests__/')
      && !/\.(?:test|spec)\.[^.]+$/.test(normalized);
  });

  for (const file of files) {
    const displayFile = path.relative(V3_ROOT, file);
    try {
      const stats = statSync(file);
      if (!stats.isFile()) continue;
      if (stats.size > MAX_SOURCE_BYTES) {
        findings.push({
          file: displayFile,
          line: 1,
          code: 'SOURCE_SIZE_LIMIT',
          detail: `Source file exceeds ${MAX_SOURCE_BYTES} bytes`,
        });
        continue;
      }
      findings.push(...auditSource(readFileSync(file, 'utf8'), displayFile));
    } catch (error) {
      findings.push({
        file: displayFile,
        line: 1,
        code: 'READ_ERROR',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { filesScanned: files.length, findings };
}

function main() {
  const json = process.argv.includes('--format=json') || process.argv.includes('--json');
  const result = auditPluginMemoryProvenance();

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.findings.length === 0) {
    console.log(`Plugin memory provenance audit passed (${result.filesScanned} source files scanned)`);
  } else {
    console.error(`Plugin memory provenance audit failed (${result.findings.length} finding(s))`);
    for (const finding of result.findings) {
      console.error(`- ${finding.file}:${finding.line} ${finding.code}: ${finding.detail}`);
    }
  }

  process.exitCode = result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
