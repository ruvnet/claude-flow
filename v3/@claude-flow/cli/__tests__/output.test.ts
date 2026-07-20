/**
 * OutputFormatter Tests
 *
 * Tests the output module in isolation, covering:
 *   - Color methods (bold, dim, success, error, warning, info, highlight)
 *   - Color enable/disable
 *   - Verbosity levels (quiet, normal, verbose, debug)
 *   - Formatted output: printSuccess, printError, printWarning, printInfo, printDebug, printTrace
 *   - Table formatting: borders, no borders, alignment, column width, maxWidth, formatter
 *   - Progress bar rendering
 *   - JSON output (pretty and compact)
 *   - List and numbered list output
 *   - Box output with and without title
 *   - supportsColor environment detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OutputFormatter } from '../src/output.js';

describe('OutputFormatter', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;
  let captured: string[];
  let errorCaptured: string[];

  beforeEach(() => {
    captured = [];
    errorCaptured = [];
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
      captured.push(String(s));
      return true;
    });
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => {
      errorCaptured.push(String(s));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
  });

  // -------------------------------------------------------------------------
  // Color enable/disable
  // -------------------------------------------------------------------------
  describe('color enable/disable', () => {
    it('should disable colors via setColorEnabled(false)', () => {
      const out = new OutputFormatter({ color: true });
      out.setColorEnabled(false);
      expect(out.isColorEnabled()).toBe(false);
      // With color disabled, color methods return plain text
      expect(out.bold('hello')).toBe('hello');
    });

    it('should enable colors via setColorEnabled(true)', () => {
      const out = new OutputFormatter({ color: false });
      out.setColorEnabled(true);
      expect(out.isColorEnabled()).toBe(true);
      expect(out.bold('hello')).toContain('\x1b[');
    });

    it('should respect color=false in constructor', () => {
      const out = new OutputFormatter({ color: false });
      expect(out.isColorEnabled()).toBe(false);
      expect(out.success('ok')).toBe('ok');
    });

    it('should respect color=true in constructor', () => {
      const out = new OutputFormatter({ color: true });
      expect(out.isColorEnabled()).toBe(true);
      expect(out.error('fail')).toContain('\x1b[31m');
    });
  });

  // -------------------------------------------------------------------------
  // Color methods
  // -------------------------------------------------------------------------
  describe('color methods', () => {
    let out: OutputFormatter;

    beforeEach(() => {
      out = new OutputFormatter({ color: true });
    });

    it('bold should wrap text with bold ANSI code', () => {
      const result = out.bold('test');
      expect(result).toContain('\x1b[1m');
      expect(result).toContain('test');
      expect(result).toContain('\x1b[0m');
    });

    it('dim should wrap text with dim ANSI code', () => {
      const result = out.dim('test');
      expect(result).toContain('\x1b[2m');
    });

    it('success should wrap text in green', () => {
      const result = out.success('ok');
      expect(result).toContain('\x1b[32m');
    });

    it('error should wrap text in red', () => {
      const result = out.error('fail');
      expect(result).toContain('\x1b[31m');
    });

    it('warning should wrap text in yellow', () => {
      const result = out.warning('careful');
      expect(result).toContain('\x1b[33m');
    });

    it('info should wrap text in blue', () => {
      const result = out.info('note');
      expect(result).toContain('\x1b[34m');
    });

    it('highlight should wrap text in cyan+bold', () => {
      const result = out.highlight('important');
      expect(result).toContain('\x1b[36m');
      expect(result).toContain('\x1b[1m');
    });

    it('color with multiple colors should apply all codes', () => {
      const result = out.color('text', 'red', 'bold');
      expect(result).toContain('\x1b[31m');
      expect(result).toContain('\x1b[1m');
    });
  });

  // -------------------------------------------------------------------------
  // Verbosity
  // -------------------------------------------------------------------------
  describe('verbosity', () => {
    it('default verbosity should be "normal"', () => {
      const out = new OutputFormatter();
      expect(out.getVerbosity()).toBe('normal');
    });

    it('should set verbosity via constructor', () => {
      const out = new OutputFormatter({ verbosity: 'debug' });
      expect(out.getVerbosity()).toBe('debug');
    });

    it('should update verbosity via setVerbosity', () => {
      const out = new OutputFormatter();
      out.setVerbosity('quiet');
      expect(out.getVerbosity()).toBe('quiet');
      expect(out.isQuiet()).toBe(true);
    });

    it('isVerbose should be true for "verbose" and "debug"', () => {
      const out = new OutputFormatter();
      out.setVerbosity('verbose');
      expect(out.isVerbose()).toBe(true);
      out.setVerbosity('debug');
      expect(out.isVerbose()).toBe(true);
      out.setVerbosity('normal');
      expect(out.isVerbose()).toBe(false);
    });

    it('isDebug should only be true for "debug"', () => {
      const out = new OutputFormatter();
      out.setVerbosity('debug');
      expect(out.isDebug()).toBe(true);
      out.setVerbosity('verbose');
      expect(out.isDebug()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Formatted output respecting verbosity
  // -------------------------------------------------------------------------
  describe('formatted output', () => {
    let out: OutputFormatter;

    beforeEach(() => {
      out = new OutputFormatter({ color: false });
    });

    it('printSuccess should always output', () => {
      out.setVerbosity('quiet');
      out.printSuccess('done');
      expect(captured.join('')).toContain('done');
    });

    it('printError should always output to stderr', () => {
      out.setVerbosity('quiet');
      out.printError('bad', 'details here');
      const allErr = errorCaptured.join('');
      expect(allErr).toContain('bad');
      expect(allErr).toContain('details here');
    });

    it('printWarning should be suppressed in quiet mode', () => {
      out.setVerbosity('quiet');
      out.printWarning('warning');
      expect(captured.join('')).not.toContain('warning');
    });

    // printWarning/printInfo/printDebug/printTrace all write to STDERR, like
    // printError — stdout is reserved for command results (e.g. --format
    // json) and must never be interleaved with incidental warnings/info.
    it('printWarning should output to stderr in normal mode', () => {
      out.setVerbosity('normal');
      out.printWarning('warning');
      expect(errorCaptured.join('')).toContain('warning');
      expect(captured.join('')).not.toContain('warning');
    });

    it('printInfo should be suppressed in quiet mode', () => {
      out.setVerbosity('quiet');
      out.printInfo('information');
      expect(errorCaptured.join('')).not.toContain('information');
    });

    it('printInfo should output to stderr in normal mode', () => {
      out.setVerbosity('normal');
      out.printInfo('information');
      expect(errorCaptured.join('')).toContain('information');
      expect(captured.join('')).not.toContain('information');
    });

    it('printDebug should only output in verbose/debug mode, to stderr', () => {
      out.setVerbosity('normal');
      out.printDebug('debug msg');
      expect(errorCaptured.join('')).not.toContain('debug msg');

      out.setVerbosity('verbose');
      out.printDebug('debug msg');
      expect(errorCaptured.join('')).toContain('debug msg');
      expect(captured.join('')).not.toContain('debug msg');
    });

    it('printTrace should only output in debug mode, to stderr', () => {
      out.setVerbosity('verbose');
      out.printTrace('trace msg');
      expect(errorCaptured.join('')).not.toContain('trace msg');

      out.setVerbosity('debug');
      out.printTrace('trace msg');
      expect(errorCaptured.join('')).toContain('trace msg');
      expect(captured.join('')).not.toContain('trace msg');
    });
  });

  // -------------------------------------------------------------------------
  // write/writeln/writeError/writeErrorln
  // -------------------------------------------------------------------------
  describe('write methods', () => {
    let out: OutputFormatter;

    beforeEach(() => {
      out = new OutputFormatter({ color: false });
    });

    it('write should write to stdout without newline', () => {
      out.write('hello');
      expect(captured).toEqual(['hello']);
    });

    it('writeln should write to stdout with newline', () => {
      out.writeln('hello');
      expect(captured).toEqual(['hello\n']);
    });

    it('writeln with no argument should write empty newline', () => {
      out.writeln();
      expect(captured).toEqual(['\n']);
    });

    it('writeError should write to stderr', () => {
      out.writeError('err');
      expect(errorCaptured).toEqual(['err']);
    });

    it('writeErrorln should write to stderr with newline', () => {
      out.writeErrorln('err');
      expect(errorCaptured).toEqual(['err\n']);
    });
  });

  // -------------------------------------------------------------------------
  // Table formatting
  // -------------------------------------------------------------------------
  describe('table formatting', () => {
    let out: OutputFormatter;

    beforeEach(() => {
      out = new OutputFormatter({ color: false });
    });

    it('should render a basic table with borders and header', () => {
      const result = out.table({
        columns: [
          { key: 'name', header: 'Name' },
          { key: 'value', header: 'Value' },
        ],
        data: [
          { name: 'alpha', value: '100' },
          { name: 'beta', value: '200' },
        ],
      });
      expect(result).toContain('Name');
      expect(result).toContain('Value');
      expect(result).toContain('alpha');
      expect(result).toContain('beta');
      expect(result).toContain('+'); // border character
      expect(result).toContain('|'); // vertical border
    });

    it('should render table without borders', () => {
      const result = out.table({
        columns: [{ key: 'x', header: 'X' }],
        data: [{ x: '1' }],
        border: false,
      });
      expect(result).not.toContain('+');
      expect(result).toContain('X');
      expect(result).toContain('1');
    });

    it('should render table without header', () => {
      const result = out.table({
        columns: [{ key: 'x', header: 'X' }],
        data: [{ x: 'val' }],
        header: false,
      });
      expect(result).toContain('val');
      // The header 'X' should not appear as a data row
      const lines = result.split('\n');
      const dataLines = lines.filter(l => l.includes('val'));
      expect(dataLines.length).toBeGreaterThan(0);
    });

    it('should use column formatter', () => {
      const result = out.table({
        columns: [
          {
            key: 'count',
            header: 'Count',
            format: (v: unknown) => `#${v}`,
          },
        ],
        data: [{ count: 42 }],
      });
      expect(result).toContain('#42');
    });

    it('should handle null/undefined values gracefully', () => {
      const result = out.table({
        columns: [{ key: 'x', header: 'X' }],
        data: [{ x: null }, { x: undefined }],
      });
      expect(result).toBeDefined();
      // Should not throw and should contain empty-ish cells
    });

    it('should handle right alignment', () => {
      const result = out.table({
        columns: [{ key: 'num', header: 'Num', align: 'right' as const }],
        data: [{ num: '5' }],
      });
      expect(result).toContain('5');
    });

    it('should handle center alignment', () => {
      const result = out.table({
        columns: [{ key: 'mid', header: 'Mid', align: 'center' as const }],
        data: [{ mid: 'X' }],
      });
      expect(result).toContain('X');
    });

    it('should respect column width limit', () => {
      const result = out.table({
        columns: [{ key: 'long', header: 'L', width: 5 }],
        data: [{ long: 'abcdefghij' }],
      });
      // Content should be truncated
      expect(result).toContain('...');
    });

    it('should respect maxWidth constraint', () => {
      const result = out.table({
        columns: [
          { key: 'a', header: 'A' },
          { key: 'b', header: 'B' },
        ],
        data: [{ a: 'aaaaaaaaaa', b: 'bbbbbbbbbb' }],
        maxWidth: 20,
      });
      expect(result).toBeDefined();
    });

    it('printTable should write table to stdout', () => {
      out.printTable({
        columns: [{ key: 'x', header: 'X' }],
        data: [{ x: '1' }],
      });
      expect(captured.join('')).toContain('X');
    });
  });

  // -------------------------------------------------------------------------
  // Progress bar
  // -------------------------------------------------------------------------
  describe('progress bar', () => {
    let out: OutputFormatter;

    beforeEach(() => {
      out = new OutputFormatter({ color: false });
    });

    it('should render progress bar at 0%', () => {
      const bar = out.progressBar(0, 100);
      expect(bar).toContain('0.0%');
    });

    it('should render progress bar at 50%', () => {
      const bar = out.progressBar(50, 100);
      expect(bar).toContain('50.0%');
    });

    it('should render progress bar at 100%', () => {
      const bar = out.progressBar(100, 100);
      expect(bar).toContain('100.0%');
    });

    it('should clamp progress bar above 100%', () => {
      const bar = out.progressBar(200, 100);
      expect(bar).toContain('100.0%');
    });

    it('should respect custom width', () => {
      const bar = out.progressBar(50, 100, 20);
      expect(bar).toContain('50.0%');
    });
  });

  // -------------------------------------------------------------------------
  // JSON output
  // -------------------------------------------------------------------------
  describe('JSON output', () => {
    let out: OutputFormatter;

    beforeEach(() => {
      out = new OutputFormatter({ color: false });
    });

    it('should produce pretty JSON by default', () => {
      const result = out.json({ a: 1 });
      expect(result).toContain('  "a": 1');
    });

    it('should produce compact JSON when pretty=false', () => {
      const result = out.json({ a: 1 }, false);
      expect(result).toBe('{"a":1}');
    });

    it('printJson should write JSON to stdout', () => {
      out.printJson({ key: 'val' });
      expect(captured.join('')).toContain('"key": "val"');
    });
  });

  // -------------------------------------------------------------------------
  // List output
  // -------------------------------------------------------------------------
  describe('list output', () => {
    let out: OutputFormatter;

    beforeEach(() => {
      out = new OutputFormatter({ color: false });
    });

    it('should render bulleted list', () => {
      const result = out.list(['apple', 'banana']);
      expect(result).toContain('- apple');
      expect(result).toContain('- banana');
    });

    it('should use custom bullet', () => {
      const result = out.list(['item'], '*');
      expect(result).toContain('* item');
    });

    it('printList should write to stdout', () => {
      out.printList(['x', 'y']);
      const text = captured.join('');
      expect(text).toContain('- x');
      expect(text).toContain('- y');
    });

    it('should render numbered list', () => {
      const result = out.numberedList(['first', 'second', 'third']);
      expect(result).toContain('1. first');
      expect(result).toContain('2. second');
      expect(result).toContain('3. third');
    });

    it('printNumberedList should write to stdout', () => {
      out.printNumberedList(['a', 'b']);
      const text = captured.join('');
      expect(text).toContain('1. a');
      expect(text).toContain('2. b');
    });
  });

  // -------------------------------------------------------------------------
  // Box output
  // -------------------------------------------------------------------------
  describe('box output', () => {
    let out: OutputFormatter;

    beforeEach(() => {
      out = new OutputFormatter({ color: false });
    });

    it('should render box without title', () => {
      const result = out.box('Hello world');
      expect(result).toContain('+');
      expect(result).toContain('|');
      expect(result).toContain('Hello world');
    });

    it('should render box with title', () => {
      const result = out.box('Content', 'Title');
      expect(result).toContain('Title');
      expect(result).toContain('Content');
      expect(result).toContain('+');
    });

    it('should handle multiline content', () => {
      const result = out.box('Line 1\nLine 2\nLine 3');
      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
      expect(result).toContain('Line 3');
    });

    it('printBox should write to stdout', () => {
      out.printBox('test content', 'box title');
      const text = captured.join('');
      expect(text).toContain('test content');
      expect(text).toContain('box title');
    });
  });

  // -------------------------------------------------------------------------
  // supportsColor environment detection
  // -------------------------------------------------------------------------
  describe('supportsColor environment detection', () => {
    it('should disable color when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      const out = new OutputFormatter();
      expect(out.isColorEnabled()).toBe(false);
    });

    it('should enable color when FORCE_COLOR is set', () => {
      process.env.FORCE_COLOR = '1';
      const out = new OutputFormatter();
      expect(out.isColorEnabled()).toBe(true);
    });
  });
});
