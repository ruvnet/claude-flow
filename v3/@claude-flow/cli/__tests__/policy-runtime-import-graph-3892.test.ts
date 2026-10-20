import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('policy runtime eager dependency graph (#3989 / #3892)', () => {
  it('keeps the security barrel out of all transitively imported CLI helpers', () => {
    const visited = new Set<string>();
    const violations: string[] = [];
    function visit(file: string): void {
      if (visited.has(file)) return;
      visited.add(file);
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const node of source.statements) {
        if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
        if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) continue;
        if (ts.isExportDeclaration(node) && node.isTypeOnly) continue;
        const specifier = node.moduleSpecifier;
        if (!specifier || !ts.isStringLiteral(specifier)) continue;
        const name = specifier.text;
        if (name === '@claude-flow/security') violations.push(`${file}: ${name}`);
        if (name.startsWith('.')) visit(resolve(dirname(file), name.replace(/\.js$/, '.ts')));
      }
    }
    visit(fileURLToPath(new URL('../src/services/policy-runtime.ts', import.meta.url)));
    expect(visited.size).toBeGreaterThan(5);
    expect(violations).toEqual([]);
  });
});
