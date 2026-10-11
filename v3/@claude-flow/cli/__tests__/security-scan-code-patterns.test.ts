import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CommandContext } from '../src/types.js';

vi.mock('../src/output.js', () => ({
  output: {
    writeln: () => {}, printJson: () => {}, printTable: () => {}, printBox: () => {}, printError: () => {}, printWarning: () => {},
    bold: (v: string) => v, dim: (v: string) => v, success: (v: string) => v, error: (v: string) => v, warning: (v: string) => v, info: (v: string) => v,
    createSpinner: () => ({ start: () => {}, setText: () => {}, succeed: () => {}, fail: () => {} }),
  },
}));

import { securityCommand } from '../src/commands/security.js';

const scan = securityCommand.subcommands!.find(command => command.name === 'scan')!;
let target: string;

type Finding = { severity: string; type: string; location: string };

async function findings(files: Record<string, string>): Promise<Finding[]> {
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(target, name, '..'), { recursive: true });
    writeFileSync(join(target, name), body);
  }
  const ctx: CommandContext = { args: [], flags: { _: [], target, depth: 'standard', type: 'code', output: 'json' }, cwd: target, interactive: false };
  await scan.action!(ctx);
  return JSON.parse(readFileSync(join(target, '.claude/security-scans/scan-code-standard.json'), 'utf8')).findings;
}

const types = (rows: Finding[]) => rows.map(row => `${row.type} ${row.location}`).sort();

beforeEach(() => { target = mkdtempSync(join(tmpdir(), 'ruflo-scan-patterns-')); });
afterEach(() => { rmSync(target, { recursive: true, force: true }); });

describe('security scan code patterns: false positives seen on a real tree', () => {
  it('does not report eval inside a longer word such as "retrieval ("', async () => {
    expect(await findings({ 'copy.ts': 'export const label = "Memory + retrieval (vector) and private inference";\n' })).toEqual([]);
  });

  it('does not report child_process.execFile named in comments as command injection', async () => {
    expect(await findings({
      'discovery.ts': [
        '// TailscaleDiscovery only needs Node built-ins (`child_process.execFile`),',
        '/**',
        ' * No new dependency: shells out via `node:child_process.execFile`,',
        ' */',
      ].join('\n'),
    })).toEqual([]);
  });

  it('does not report a numbered SQL placeholder ($${n}) as SQL injection', async () => {
    expect(await findings({
      'store.js': [
        '    sql += ` AND t.category_id = $${paramCount}`;',
        '    sql += ` ORDER BY text_score DESC LIMIT $${paramCount + 1}`;',
        '    const q = `SELECT * FROM t WHERE id IN ($${params.length}, $${values.length + 1})`;',
      ].join('\n'),
    })).toEqual([]);
  });

  it('skips generated coverage and Playwright report bundles, known by their marker files', async () => {
    expect(await findings({
      'coverage/coverage-final.json': '{}',
      'coverage/prettify.js': 'el.innerHTML = html;\n',
      'e2e/playwright-report/index.html': '<html></html>',
      'e2e/playwright-report/trace/assets/view.js': 'node.innerHTML = s; eval(x);\n',
    })).toEqual([]);
  });

  it('does not report a URL or a pattern inside a string as a comment boundary', async () => {
    expect(await findings({ 'u.ts': "const u = 'http://x/*'; const v = 1;\n" })).toEqual([]);
  });
});

describe('security scan code patterns: real findings still reported', () => {
  it('reports eval calls, including window.eval', async () => {
    expect(types(await findings({ 'a.ts': 'eval(userInput);\nwindow.eval(bundle);\n' }))).toEqual(['Eval Usage a.ts:1', 'Eval Usage a.ts:2']);
  });

  it('reports exec and execSync called through child_process', async () => {
    expect(types(await findings({
      'b.ts': "require('child_process').exec(`ls ${dir}`);\nchild_process.execSync(cmd);\n",
    }))).toEqual(['Command Injection b.ts:1', 'Command Injection b.ts:2']);
  });

  it('reports an interpolated value in SQL, also next to a placeholder', async () => {
    expect(types(await findings({
      'c.ts': 'const sql = `SELECT * FROM users WHERE id = ${id}`;\nsql += ` AND a = $${n} AND b = ${name}`;\n',
    }))).toEqual(['SQL Injection c.ts:1', 'SQL Injection c.ts:2']);
  });

  it('reports innerHTML and dangerouslySetInnerHTML in source', async () => {
    expect(types(await findings({ 'src/d.tsx': 'el.innerHTML = html;\n<div dangerouslySetInnerHTML={{ __html: body }} />\n' })))
      .toEqual(['React XSS src/d.tsx:2', 'innerHTML src/d.tsx:1']);
  });
});

describe('security scan code patterns: shapes the narrowing must not hide', () => {
  it('scans code that shares a line with a comment, a generator method and JSX continuation lines', async () => {
    expect(types(await findings({
      'e.tsx': [
        '/* route */ eval(userInput);',
        '/* start',
        '   end */ eval(userInput);',
        'class A { * run() { eval(userInput); } }',
        '  * <span dangerouslySetInnerHTML={{ __html: userInput }} />',
        'const x = 1 // eval(commented)',
      ].join('\n'),
    }))).toEqual(['Eval Usage e.tsx:1', 'Eval Usage e.tsx:3', 'Eval Usage e.tsx:4', 'React XSS e.tsx:5']);
  });

  it('reports every exec use the old rule reported, execFile included, as command injection', async () => {
    const lines = [
      "require('child_process').execFile('sh', ['-c', userInput]);",
      "require('child_process').execFile('echo', [userInput], { shell: true });",
      "require('child_process').exec.call(null, userInput);",
      "require('child_process').exec/*why*/(userInput);",
      "require('child_process').execFile('/usr/bin/env', ['sh', '-c', userCmd]);",
      "require('child_process').execFile('node', ['-e', userCode]);",
      "require('child_process').execFileSync('bash.exe', ['-c', userCmd]);",
      "require('child_process').exec?.(input);",
      "require('child_process')['exec'](input);",
      "module.exports = require('child_process').exec;",
      "(require('child_process').exec as any)(cmd);",
      "const { exec } = require('child_process'); const run = promisify(exec);",
      "const { exec, execFile } = require('child_process'); register(exec, 1); execFile('git', ['status']);",
      "const {exec} = require('child_process'); Reflect.apply(exec, null, [input]);",
      "require('child_process').execFile('git', ['status'], (a = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') => a);",
    ];
    expect(types(await findings({ 'f.ts': lines.join('\n') })))
      .toEqual(lines.map((_, i) => `Command Injection f.ts:${i + 1}`).sort());
  });

  it('keeps a /* inside a regex or JSX text from hiding the lines after it', async () => {
    expect(types(await findings({
      'h.tsx': "const r = /[/*]/;\neval(input);\nconst v = <p>don't</p>; const s = '/*';\neval(input);\n",
    }))).toEqual(['Eval Usage h.tsx:2', 'Eval Usage h.tsx:4']);
  });

  it('reports a $${value} that is quoted or not counter-shaped, as SQL injection', async () => {
    expect(types(await findings({
      'g.ts': [
        "const sql = `SELECT * FROM users WHERE name = '$${userInput}'`;",
        'const sql2 = `SELECT * FROM t WHERE id = $${userInput}`;',
        "const sql3 = `SELECT * FROM users WHERE name = 'prefix $${discount} suffix'`;",
        'const sql4 = `SELECT * FROM t WHERE id = $${amount}`;',
      ].join('\n'),
    }))).toEqual(['SQL Injection g.ts:1', 'SQL Injection g.ts:2', 'SQL Injection g.ts:3', 'SQL Injection g.ts:4']);
  });

  it('still scans source in a folder named coverage, with or without report markers', async () => {
    expect(types(await findings({
      'src/coverage/handler.ts': 'eval(userInput);\n',
      'coverage/lcov.info': '',
      'coverage/handler.ts': 'eval(userInput);\n',
      'playwright-report/index.html': '',
      'playwright-report/handler.ts': 'eval(userInput);\n',
    }))).toEqual(['Eval Usage coverage/handler.ts:1', 'Eval Usage playwright-report/handler.ts:1', 'Eval Usage src/coverage/handler.ts:1']);
  });

  it('scans a folder named constructor or __proto__', async () => {
    expect(types(await findings({ 'constructor/a.ts': 'eval(input);\n', '__proto__/b.ts': 'eval(input);\n' })))
      .toEqual(['Eval Usage __proto__/b.ts:1', 'Eval Usage constructor/a.ts:1']);
  });

  it('keeps a line-start /* in JSX text, never closed, from hiding the lines after it', async () => {
    expect(types(await findings({
      'j.tsx': "const view = <p>\n/*\n</p>;\neval(input);\nrequire('child_process').exec(input);\n",
    }))).toEqual(['Command Injection j.tsx:5', 'Eval Usage j.tsx:4']);
  });

  it('reports a counter placeholder inside SQL quotes, wherever the quote count lands', async () => {
    expect(types(await findings({
      'k.ts': [
        'const label = "\'"; const sql = `SELECT \'$${paramCount}\'`;',
        'const sql = `SELECT "$${paramCount}" FROM t`;',
        "const sql = `SELECT * FROM t WHERE name = 'prefix = $${paramCount} suffix'`;",
      ].join('\n'),
    }))).toEqual(['SQL Injection k.ts:1', 'SQL Injection k.ts:2', 'SQL Injection k.ts:3']);
  });

  it('keeps a backtick misread in a regex or JSX from hiding later lines through a template /*', async () => {
    expect(types(await findings({
      'n.tsx': [
        'const Q = /[`]/;',
        'const t = `',
        '/* text',
        '`;',
        'eval(userInput);',
        "require('child_process').exec(userCmd);",
        "const glob = '**/*.ts';",
        'fetch(`https://api.example.com/${id}`); eval(userInput);',
      ].join('\n'),
    }))).toEqual(['Command Injection n.tsx:6', 'Eval Usage n.tsx:5', 'Eval Usage n.tsx:8']);
  });

  it('reports a counter placeholder that is not where SQL takes a value, or not param-named', async () => {
    expect(types(await findings({
      'p.ts': [
        'const sql = `SELECT x$${paramCount} FROM t`;',
        'const sql = `SELECT * FROM t WHERE id = $${paramCount}abc`;',
        'const sql = `SELECT * FROM t OFFSET $${pageNum}`;',
        'const sql = `SELECT * FROM t WHERE id = $${userIdx}`;',
        'const sql = `UPDATE t SET a = $${req.body.length}`;',
      ].join('\n'),
    }))).toEqual([1, 2, 3, 4, 5].map(n => `SQL Injection p.ts:${n}`));
  });

  it('scans report-named assets when their marker file is absent', async () => {
    expect(types(await findings({
      'coverage/prettify.js': 'el.innerHTML = html;\n',
      'playwright-report/trace/view.js': 'eval(x);\n',
    }))).toEqual(['Eval Usage playwright-report/trace/view.js:1', 'innerHTML coverage/prettify.js:1']);
  });

  it('reads a regex literal as code, so a // or /* or backtick inside it hides nothing', async () => {
    expect(types(await findings({
      'r.ts': [
        'const r = /[//]/; eval(input);',
        'const s = /[/*]/; eval(input);',
        'const Q = /[`]/;',
        'const t = `',
        '/*',
        '* ${eval(input)}',
        '`;',
        'const half = a / b; eval(input); // eval(commented)',
      ].join('\n'),
    }))).toEqual(['Eval Usage r.ts:1', 'Eval Usage r.ts:2', 'Eval Usage r.ts:6', 'Eval Usage r.ts:8']);
  });

  it('keeps a URL after a backtick misread in JSX text from blanking the rest of its line', async () => {
    expect(types(await findings({
      'k.tsx': 'const v = <kbd>`</kbd>;\nfetch(`https://api.example.com/${id}`); eval(input);\n',
    }))).toEqual(['Eval Usage k.tsx:2']);
  });

  it('reports a counter placeholder inside double-quoted SQL text, or after an escaped backtick in quotes', async () => {
    expect(types(await findings({
      'q.ts': [
        'const sql = `SELECT "x = $${paramCount} y" FROM t`;',
        "const sql = `SELECT 'x \\` = $${paramCount} y' FROM t`;",
        'const sql = `SELECT * FROM t WHERE id = $${userargs.length}`;',
      ].join('\n'),
    }))).toEqual(['SQL Injection q.ts:1', 'SQL Injection q.ts:2', 'SQL Injection q.ts:3']);
  });

  it('stays linear on lines of comment openers, placeholders and regex starts', async () => {
    const started = Date.now();
    await findings({
      'long.js': [
        'x; /* */'.repeat(16_000),
        'const sql = `SELECT ' + Array(8_000).fill('$${paramCount}').join(', ') + '`;',
        '(/'.repeat(16_000),
        '[/'.repeat(16_000),
        'x / '.repeat(64_000) + 'z',
      ].join('\n'),
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('scans many unclosed line-start comment openers in linear time', async () => {
    const started = Date.now();
    await findings({ 'open.js': '/* x\n'.repeat(40_000) + 'eval(input);\n' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('scans a long minified line in linear time', async () => {
    const started = Date.now();
    await findings({ 'min.js': `const s = "${'$$" + "{'.repeat(32_000)}"; const sql = 1;\n` });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

