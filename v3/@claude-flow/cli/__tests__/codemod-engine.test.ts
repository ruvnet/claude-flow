import { describe, it, expect } from 'vitest';
import {
  applyCodemod,
  isDeterministicCodemod,
  DETERMINISTIC_CODEMOD_INTENTS,
  MODEL_ROUTED_INTENTS,
} from '../src/ruvector/codemods/engine.js';

describe('codemod engine — registry', () => {
  it('classifies deterministic vs model-routed intents', () => {
    expect(isDeterministicCodemod('var-to-const')).toBe(true);
    expect(isDeterministicCodemod('remove-console')).toBe(true);
    expect(isDeterministicCodemod('add-logging')).toBe(true);
    for (const i of MODEL_ROUTED_INTENTS) {
      expect(isDeterministicCodemod(i)).toBe(false);
    }
  });

  it('refuses non-deterministic intents with a reason', () => {
    const r = applyCodemod('add-types', 'const x = 1;', { language: 'typescript' });
    expect(r.success).toBe(false);
    expect(r.changed).toBe(false);
    expect(r.reason).toMatch(/not a deterministic codemod/i);
  });

  it('never throws on malformed input', () => {
    const r = applyCodemod('var-to-const', 'var x = = = ;;;{{{', { language: 'javascript' });
    expect(r).toBeDefined();
    // Either no-op or aborted; must not crash and must not worsen parse errors.
    expect(typeof r.output).toBe('string');
  });
});

describe('var-to-const', () => {
  it('uses const when never reassigned', () => {
    const r = applyCodemod('var-to-const', 'var x = 1;\nvar y = 2;', { language: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.output).toBe('const x = 1;\nconst y = 2;');
    expect(r.edits).toBe(2);
  });

  it('uses let when reassigned via =', () => {
    const r = applyCodemod('var-to-const', 'var x = 1;\nx = 2;', { language: 'javascript' });
    expect(r.output).toBe('let x = 1;\nx = 2;');
  });

  it('uses let for a for-loop counter mutated with ++', () => {
    const src = 'for (var i = 0; i < 3; i++) {\n  doThing(i);\n}';
    const r = applyCodemod('var-to-const', src, { language: 'javascript' });
    expect(r.output).toContain('for (let i = 0;');
  });

  it('preserves comments and indentation', () => {
    const src = '// counter\nfunction f() {\n  var n = 0; // local\n  return n;\n}';
    const r = applyCodemod('var-to-const', src, { language: 'javascript' });
    expect(r.output).toBe('// counter\nfunction f() {\n  const n = 0; // local\n  return n;\n}');
  });

  it('handles destructuring declarations', () => {
    const r = applyCodemod('var-to-const', 'var { a, b } = obj;', { language: 'javascript' });
    expect(r.output).toBe('const { a, b } = obj;');
  });

  it('is idempotent (second run is a no-op)', () => {
    const first = applyCodemod('var-to-const', 'var x = 1;', { language: 'javascript' });
    const second = applyCodemod('var-to-const', first.output, { language: 'javascript' });
    expect(second.changed).toBe(false);
    expect(second.output).toBe(first.output);
  });

  it('does not touch existing let/const', () => {
    const r = applyCodemod('var-to-const', 'const a = 1;\nlet b = 2;', { language: 'javascript' });
    expect(r.changed).toBe(false);
  });

  // Scope-aware analysis (ADR-143 #2): a reassignment in an unrelated scope
  // must not force an unrelated var to `let`.
  it('uses const when the only reassignment is in a different function', () => {
    const src = [
      'function a() {',
      '  var x = 1;',   // never reassigned in a()
      '  return x;',
      '}',
      'function b() {',
      '  var x = 1;',   // reassigned only here
      '  x = 2;',
      '  return x;',
      '}',
    ].join('\n');
    const r = applyCodemod('var-to-const', src, { language: 'javascript' });
    // a()'s x → const; b()'s x → let
    expect(r.output).toContain('function a() {\n  const x = 1;');
    expect(r.output).toContain('function b() {\n  let x = 1;');
  });

  it('uses let when an inner closure reassigns the outer var', () => {
    const src = [
      'function outer() {',
      '  var x = 1;',
      '  function inner() { x = 2; }',
      '  inner();',
      '  return x;',
      '}',
    ].join('\n');
    const r = applyCodemod('var-to-const', src, { language: 'javascript' });
    expect(r.output).toContain('  let x = 1;');
  });

  it('shadowing inner var reassignment does not force outer var to let', () => {
    const src = [
      'function outer() {',
      '  var x = 1;',                      // not reassigned in outer
      '  function inner() { var x = 9; x = 2; }', // own x reassigned
      '  return x;',
      '}',
    ].join('\n');
    const r = applyCodemod('var-to-const', src, { language: 'javascript' });
    expect(r.output).toContain('  const x = 1;'); // outer x stays const
    expect(r.output).toContain('var x = 9; x = 2;'.replace('var', 'let')); // inner x → let
  });
});

describe('remove-console', () => {
  it('removes an own-line console statement and its line', () => {
    const src = 'const a = 1;\nconsole.log(a);\nconst b = 2;';
    const r = applyCodemod('remove-console', src, { language: 'javascript' });
    expect(r.output).toBe('const a = 1;\nconst b = 2;');
  });

  it('removes console.error/warn/debug too', () => {
    const src = 'console.error("x");\nconsole.warn("y");\nfoo();';
    const r = applyCodemod('remove-console', src, { language: 'javascript' });
    expect(r.output).toBe('foo();');
  });

  it('preserves indentation of surrounding code', () => {
    const src = 'function f() {\n  console.log("hi");\n  return 1;\n}';
    const r = applyCodemod('remove-console', src, { language: 'javascript' });
    expect(r.output).toBe('function f() {\n  return 1;\n}');
  });

  it('no-ops when there is no console call', () => {
    const r = applyCodemod('remove-console', 'const x = 1;', { language: 'javascript' });
    expect(r.changed).toBe(false);
  });

  it('does not remove non-console calls', () => {
    const src = 'logger.log("keep me");';
    const r = applyCodemod('remove-console', src, { language: 'javascript' });
    expect(r.changed).toBe(false);
  });
});

describe('add-logging', () => {
  it('inserts an entry log into a named function', () => {
    const src = 'function greet() {\n  return 1;\n}';
    const r = applyCodemod('add-logging', src, { language: 'javascript' });
    expect(r.output).toBe("function greet() {\n  console.log(\"greet called\");\n  return 1;\n}");
  });

  it('names arrow functions from their variable', () => {
    const src = 'const add = (a, b) => {\n  return a + b;\n};';
    const r = applyCodemod('add-logging', src, { language: 'javascript' });
    expect(r.output).toContain('console.log("add called");');
  });

  it('is idempotent (does not double-insert)', () => {
    const src = 'function f() {\n  return 1;\n}';
    const first = applyCodemod('add-logging', src, { language: 'javascript' });
    const second = applyCodemod('add-logging', first.output, { language: 'javascript' });
    expect(second.changed).toBe(false);
    expect(second.output).toBe(first.output);
  });

  it('produces output that still parses', () => {
    const src = 'class C {\n  method() {\n    return 2;\n  }\n}';
    const r = applyCodemod('add-logging', src, { language: 'typescript' });
    expect(r.success).toBe(true);
    expect(r.output).toContain('console.log("method called");');
  });
});

describe('exported constants', () => {
  it('exposes the deterministic intent list', () => {
    expect([...DETERMINISTIC_CODEMOD_INTENTS].sort()).toEqual(
      ['add-logging', 'remove-console', 'var-to-const'],
    );
  });
});
