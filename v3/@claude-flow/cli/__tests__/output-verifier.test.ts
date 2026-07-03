/**
 * Tests for the confidence-gated tier-escalation verifier
 * (src/ruvector/output-verifier.ts) and its MCP surface (hooks_model-verify).
 *
 * All checks are $0 structural heuristics — no LLM, no network.
 */
import { describe, it, expect } from 'vitest';
import { verifyAndEscalate, bracketsBalanced, extractCodeBlocks } from '../src/ruvector/output-verifier.js';
import { hooksModelVerify } from '../src/mcp-tools/hooks-tools.js';

const GOOD_CODE_OUTPUT = [
  'Here is the implementation:',
  '',
  '```ts',
  'export function add(a: number, b: number): number {',
  '  return a + b;',
  '}',
  '```',
  '',
  'The function adds two numbers and returns the sum.',
].join('\n');

describe('output-verifier — refusal detection', () => {
  it('flags a refusal near the start of the output', async () => {
    const v = await verifyAndEscalate({
      task: 'Write a function that adds two numbers',
      output: "I'm sorry, but I can't help with that request.",
      model: 'haiku',
    });
    expect(v.confident).toBe(false);
    expect(v.reasons.some(r => r.startsWith('refusal'))).toBe(true);
  });

  it('does not flag prose that merely discusses refusals later in the text', async () => {
    const body = `${'The verifier catches several failure classes. '.repeat(8)}One class is when a model says "I cannot help" — that is a refusal pattern.`;
    const v = await verifyAndEscalate({ task: 'Explain the verifier design', output: body, taskKind: 'text' });
    expect(v.signals.find(s => s.name === 'refusal')?.ok).toBe(true);
  });
});

describe('output-verifier — emptiness and truncation', () => {
  it('flags empty output', async () => {
    const v = await verifyAndEscalate({ task: 'Summarize the design doc in detail', output: '   \n  ' });
    expect(v.confident).toBe(false);
    expect(v.reasons.some(r => r.startsWith('empty-output'))).toBe(true);
  });

  it('flags an unclosed code fence as truncation', async () => {
    const v = await verifyAndEscalate({
      task: 'Write a helper function',
      output: 'Sure, here it is:\n```ts\nexport function half(n: number) {\n  return n / 2;\n}\n',
      model: 'haiku',
    });
    expect(v.confident).toBe(false);
    expect(v.reasons.some(r => r.startsWith('truncation'))).toBe(true);
  });

  it('flags output that ends mid-expression', async () => {
    const v = await verifyAndEscalate({
      task: 'Describe the steps required for the migration in detail',
      output: 'First we back up the database, then we run the migration and finally we,',
      taskKind: 'text',
    });
    expect(v.confident).toBe(false);
    expect(v.reasons.some(r => r.startsWith('truncation'))).toBe(true);
  });

  it('flags degenerate repetition', async () => {
    const line = 'The system processes the request.';
    const v = await verifyAndEscalate({
      task: 'Describe the pipeline in detail',
      output: Array(8).fill(line).join('\n'),
      taskKind: 'text',
    });
    expect(v.confident).toBe(false);
    expect(v.reasons.some(r => r.startsWith('degenerate-repetition'))).toBe(true);
  });
});

describe('output-verifier — parseable-code check', () => {
  it('fails code that does not parse (TypeScript syntactic diagnostics)', async () => {
    const v = await verifyAndEscalate({
      task: 'Implement a TypeScript function',
      output: 'Done:\n```ts\nexport function broken(a: number { return a + ; }\n```\nThat should work.',
      model: 'haiku',
    });
    expect(v.taskKind).toBe('code');
    expect(v.confident).toBe(false);
    expect(v.reasons.some(r => r.startsWith('code-parses'))).toBe(true);
  });

  it('passes well-formed code output', async () => {
    const v = await verifyAndEscalate({
      task: 'Implement a TypeScript add function',
      output: GOOD_CODE_OUTPUT,
      model: 'haiku',
    });
    expect(v.taskKind).toBe('code');
    expect(v.confident).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.score).toBe(1);
    expect(v.escalate).toBe(false);
    expect(v.suggestedTier).toBe(2); // haiku tier, unchanged
    expect(v.suggestedModel).toBeNull();
  });

  it('fails invalid JSON when the task asks for JSON', async () => {
    const v = await verifyAndEscalate({
      task: 'Return the configuration as JSON',
      output: '{ "name": "demo", "count": }',
      taskKind: 'json',
    });
    expect(v.confident).toBe(false);
    expect(v.reasons.some(r => r.startsWith('code-parses'))).toBe(true);
  });
});

describe('output-verifier — escalation ladder', () => {
  it('bumps tier 2 → 3 and haiku → sonnet on failure', async () => {
    const v = await verifyAndEscalate({ task: 'Do a complex nontrivial thing carefully', output: '', model: 'haiku' });
    expect(v.escalate).toBe(true);
    expect(v.suggestedTier).toBe(3);
    expect(v.suggestedModel).toBe('sonnet');
  });

  it('bumps sonnet → opus on failure (tier stays 3)', async () => {
    const v = await verifyAndEscalate({ task: 'Do a complex nontrivial thing carefully', output: '', model: 'sonnet' });
    expect(v.escalate).toBe(true);
    expect(v.suggestedTier).toBe(3);
    expect(v.suggestedModel).toBe('opus');
  });

  it('cannot escalate past opus — escalate=false with an explanatory reason', async () => {
    const v = await verifyAndEscalate({ task: 'Do a complex nontrivial thing carefully', output: '', model: 'opus' });
    expect(v.confident).toBe(false);
    expect(v.escalate).toBe(false);
    expect(v.suggestedModel).toBeNull();
    expect(v.reasons.some(r => r.startsWith('already-at-top-tier'))).toBe(true);
  });
});

describe('output-verifier — helpers', () => {
  it('bracketsBalanced ignores brackets inside strings and comments', () => {
    expect(bracketsBalanced('const s = "((("; // }}}\nconst x = { a: [1] };')).toBe(true);
    expect(bracketsBalanced('function f() { return [1, 2;')).toBe(false);
  });

  it('extractCodeBlocks pulls fenced blocks with language tags', () => {
    const blocks = extractCodeBlocks('a\n```ts\nconst x = 1;\n```\nb\n```json\n{}\n```');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].lang).toBe('ts');
    expect(blocks[1].lang).toBe('json');
  });
});

describe('hooks_model-verify MCP tool', () => {
  it('returns an escalation verdict for a bad output (record:false keeps state untouched)', async () => {
    const result = await hooksModelVerify.handler({
      task: 'Implement a TypeScript function that parses a config file',
      output: "I'm sorry, I cannot help with that.",
      model: 'haiku',
      record: false,
    }) as Record<string, unknown>;
    expect(result.confident).toBe(false);
    expect(result.escalate).toBe(true);
    expect(result.suggestedModel).toBe('sonnet');
    expect(result.suggestedTier).toBe(3);
    expect(result.recorded).toBe(false);
    expect(result.recordedOutcome).toBeNull();
  });

  it('is confident about a good output', async () => {
    const result = await hooksModelVerify.handler({
      task: 'Implement a TypeScript add function',
      output: GOOD_CODE_OUTPUT,
      model: 'haiku',
      record: false,
    }) as Record<string, unknown>;
    expect(result.confident).toBe(true);
    expect(result.escalate).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('rejects missing output', async () => {
    const result = await hooksModelVerify.handler({ task: 'x'.repeat(30) }) as Record<string, unknown>;
    expect(result.success).toBe(false);
  });
});
