/**
 * ADR-174 follow-up: capture FAILURES in the learning substrate.
 *
 * The DB analysis found 898 feedback records, 100% success, 0 failures — the
 * post-edit/post-task hooks recorded a hardcoded `success:true` and never
 * inspected the tool outcome, so the oracle tier had no negative examples.
 *
 * `isToolFailure()` is the detector the generated hook + the shipped
 * hook-handler.cjs both inline. It reads Claude Code's PostToolUse
 * `tool_response` and returns true only on a POSITIVE error signal.
 */
import { describe, it, expect } from 'vitest';
import { isToolFailure } from '../src/init/helpers-generator.js';

describe('isToolFailure — PostToolUse outcome detection', () => {
  it('treats missing/ambiguous payloads as success (conservative)', () => {
    expect(isToolFailure(undefined)).toBe(false);
    expect(isToolFailure(null)).toBe(false);
    expect(isToolFailure({})).toBe(false);
    expect(isToolFailure({ tool_response: null })).toBe(false);
    expect(isToolFailure({ tool_response: { content: 'edited ok' } })).toBe(false);
    expect(isToolFailure({ tool_response: 'File updated successfully' })).toBe(false);
  });

  it('detects the structured error markers Claude Code sets on tool failure', () => {
    expect(isToolFailure({ tool_response: { is_error: true, content: 'String to replace not found' } })).toBe(true);
    expect(isToolFailure({ toolResponse: { isError: true } })).toBe(true);
    expect(isToolFailure({ tool_response: { success: false } })).toBe(true);
    expect(isToolFailure({ tool_response: { error: 'ENOENT' } })).toBe(true);
  });

  it('detects a non-zero Bash exit code as failure', () => {
    expect(isToolFailure({ tool_response: { exit_code: 1 } })).toBe(true);
    expect(isToolFailure({ tool_response: { exitCode: 127 } })).toBe(true);
    expect(isToolFailure({ tool_response: { code: 2 } })).toBe(true);
    expect(isToolFailure({ tool_response: { exit_code: 0 } })).toBe(false); // success
  });

  it('detects error strings in a plain-string tool_response', () => {
    expect(isToolFailure({ tool_response: 'Error: string to replace not found in file' })).toBe(true);
    expect(isToolFailure({ result: 'bash: command not found' })).toBe(true);
    expect(isToolFailure({ tool_response: 'Traceback (most recent call last):' })).toBe(true);
    expect(isToolFailure({ tool_response: 'permission denied' })).toBe(true);
  });

  it('does not false-positive on benign content that merely mentions success', () => {
    expect(isToolFailure({ tool_response: 'Successfully wrote 42 lines' })).toBe(false);
    expect(isToolFailure({ tool_response: { content: [{ type: 'text', text: 'done' }] } })).toBe(false);
  });
});
