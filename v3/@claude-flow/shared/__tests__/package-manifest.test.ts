/**
 * Package manifest tests
 *
 * The published tarball is installed without the workspace, so every package
 * the compiled code imports at runtime must be declared in `dependencies`.
 * 3.0.1–3.0.3 declared only sql.js: `@claude-flow/shared` and `/core` failed
 * with "Cannot find package 'zod'" and `/mcp` with "Cannot find package 'express'".
 *
 * @module v3/shared/__tests__/package-manifest.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));

const isTestFile = (path: string) => /\.(test|spec)\.ts$/.test(path) || path.includes('__tests__');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.d.ts') && !isTestFile(path) ? [path] : [];
  });
}

const packageName = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

/** Bare specifiers that survive compilation: type-only imports and exports are erased, as tsc erases them. */
function runtimeSpecifiers(source: string, fileName = 'x.ts'): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const add = (node: ts.Expression | undefined) => {
    if (node && ts.isStringLiteralLike(node)) found.push(node.text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (!clause.name && bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly)));
      if (!onlyTypes) add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      const onlyTypes = node.isTypeOnly || (clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly));
      if (!onlyTypes) add(node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0]);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found.filter((s) => !s.startsWith('.') && !isBuiltin(s)).map(packageName);
}

describe('runtimeSpecifiers', () => {
  it('finds every runtime import form', () => {
    const source = [
      "import a from 'default-import';",
      "import * as b from 'namespace-import';",
      "import {\n  c,\n  d,\n} from 'multi-line';",
      "import 'side-effect';",
      "const x = 1; export * from 'star-reexport';",
      "export { e } from 'named-reexport';",
      "import { type F, g } from 'mixed-type-and-value';",
      "const h = await import(/* note */ 'dynamic');",
      "import i = require('import-equals');",
      "import j from '@scope/pkg/sub/path';",
    ].join('\n');
    expect(runtimeSpecifiers(source)).toEqual([
      'default-import', 'namespace-import', 'multi-line', 'side-effect', 'star-reexport',
      'named-reexport', 'mixed-type-and-value', 'dynamic', 'import-equals', '@scope/pkg',
    ]);
  });

  it('ignores what tsc erases or never resolves', () => {
    const source = [
      "import type { A } from 'type-only';",
      "import { type B } from 'inline-type-only';",
      "export type { C } from 'type-reexport';",
      "// import d from 'line-comment';",
      "/* import e from 'block-comment'; */",
      "const t = `import f from 'template-text'`;",
      "const s = '/* import g from \"string-text\" */';",
      "import fs from 'fs'; import p from 'node:path'; import w from 'worker_threads';",
      "import local from './local.js';",
    ].join('\n');
    expect(runtimeSpecifiers(source)).toEqual([]);
  });
});

describe('@claude-flow/shared package manifest', () => {
  const imports = new Map<string, string>();
  for (const file of sourceFiles(join(root, 'src'))) {
    for (const name of runtimeSpecifiers(readFileSync(file, 'utf8'), file)) {
      if (!imports.has(name)) imports.set(name, file.slice(root.length + 1));
    }
  }

  it('declares every package imported at runtime by src/ in dependencies', () => {
    const declared = new Set(Object.keys(pkg.dependencies ?? {}));
    const missing = [...imports].filter(([name]) => name !== pkg.name && !declared.has(name));
    expect(Object.fromEntries(missing)).toEqual({});
  });

  it('finds the imports this guard exists for (the scan is not vacuous)', () => {
    for (const name of ['zod', 'express', 'ws', 'sql.js']) expect(imports.has(name)).toBe(true);
  });

  it('declares @types/ws for consumers, because dist/mcp/transport/websocket.d.ts imports ws', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toContain('@types/ws');
  });

  it('keeps test files out of the build and the tarball', () => {
    expect(tsconfig.exclude).toEqual(expect.arrayContaining(['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/**/__tests__/**']));
    expect(pkg.files).toEqual(expect.arrayContaining(['dist', '!dist/**/*.test.*', '!dist/**/*.spec.*', '!dist/**/__tests__']));
  });
});
