import { describe, expect, it } from 'vitest';
import { ActivityParser } from '../src/activity/parser.js';
import { sanitize } from '../src/activity/sanitize.js';
import { call, message, meta, own, record, result } from './activity-fixtures.js';

function parse(rows: unknown[]) {
  const parser = new ActivityParser('helper', '/root/helper');
  for (const row of rows) parser.consume(row);
  return parser;
}

describe('helper activity attribution', () => {
  it('hides copied parent history until an explicit own-thread record', () => {
    const p = parse([meta(), meta('root', null), message('PARENT SECRET', 'user'), call(), result(),
      own(), message('Check parser', 'user'), message('Working'), call('own'), result('own')]);
    expect(JSON.stringify(p.snapshot)).not.toContain('PARENT SECRET');
    expect(p.snapshot.assignment).toBe('Check parser');
    expect(p.snapshot.events.filter(e => e.kind === 'tool')).toHaveLength(1);
  });
  it('requires first-record identity and never trusts later matching metadata', () => {
    for (const first of [meta('wrong'), {}, null, []]) {
      const p = parse([first, meta(), own(), message('HIDDEN')]);
      expect(p.snapshot.available).toBe(false);
      expect(p.snapshot.events).toEqual([]);
    }
  });
  it('closes attribution on foreign metadata, wrong thread and corrupt records', () => {
    for (const boundary of [meta('foreign'), own('foreign'), null]) {
      const p = parse([meta(), own(), message('before'), boundary, message('HIDDEN'), own(), message('after')]);
      expect(p.snapshot.events.map(e => e.text)).toEqual(['before', 'after']);
    }
  });
  it('does not pair results across a foreign boundary', () => {
    const p = parse([meta(), own(), call(), own('foreign'), result(), own(), result()]);
    expect(p.snapshot.events[0]?.output).toBe('');
  });
  it('excludes reasoning, private roles and assistant messages without a public phase', () => {
    const p = parse([meta(), own(), message('HIDDEN', 'system'), message('HIDDEN', 'developer'),
      message('HIDDEN', 'assistant', 'analysis'), message('HIDDEN', 'assistant', null),
      record('response_item', { type: 'reasoning', text: 'HIDDEN' }),
      record('event_msg', { type: 'item_completed', item: { type: 'Reasoning', text: 'HIDDEN' } }),
      message('Public answer', 'assistant', 'final')]);
    expect(JSON.stringify(p.snapshot)).not.toContain('HIDDEN');
    expect(p.snapshot.events[0]?.text).toBe('Public answer');
    expect(p.snapshot.status).toBe('completed');
  });
  it('ignores encrypted content and outgoing messages do not change the assignment', () => {
    const p = parse([meta(), own(), record('response_item', { type: 'agent_message', content: [
      { type: 'text', text: 'Initial assignment' }, { type: 'encrypted_text', text: 'HIDDEN' }], recipient: '/root/helper' }),
      record('response_item', { type: 'agent_message', content: 'Reply to parent', recipient: '/root' })]);
    expect(p.snapshot.assignment).toBe('Initial assignment');
    expect(JSON.stringify(p.snapshot)).not.toContain('HIDDEN');
  });
});

describe('public tool records', () => {
  it.each([
    [{ exit_code: 0, output: '0 errors' }, 'completed'],
    [{ exit_code: 2, output: 'failed' }, 'failed'],
    [{ session_id: 42, exit_code: null }, 'running'],
    ['Script running with cell ID 7', 'running'],
    ['Process exited with code 1', 'failed'],
    ['0 errors', 'returned'],
    [{ isError: true }, 'failed'],
  ])('pairs a result and interprets explicit completion fields: %j', (output, status) => {
    const p = parse([meta(), own(), call(), result('unrelated', 'HIDDEN'), result('call', output)]);
    expect(p.snapshot.events).toHaveLength(1);
    expect(p.snapshot.events[0]?.status).toBe(status);
    expect(JSON.stringify(p.snapshot)).not.toContain('HIDDEN');
  });
  it('supports custom calls and command execution item events', () => {
    const p = parse([meta(), own(),
      record('response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'x', input: 'echo safe' }),
      record('response_item', { type: 'custom_tool_call_output', call_id: 'x', output: 'safe' }),
      record('event_msg', { type: 'item_started', item: { type: 'CommandExecution', id: 'y', command: 'false' } }),
      record('event_msg', { type: 'item_completed', item: { type: 'CommandExecution', id: 'y', exit_code: 1, aggregated_output: 'failed' } }),
    ]);
    expect(p.snapshot.events).toHaveLength(2);
    expect(p.snapshot.events[1]?.status).toBe('failed');
  });
  it('shows native AgentMessage final answers with Text blocks and completed state', () => {
    const p = parse([meta(), own(), call(), record('event_msg', {
      type: 'item_completed', item: { type: 'AgentMessage', phase: 'final_answer', content: [
        { type: 'Text', text: 'Finished' }, { type: 'encrypted_text', text: 'HIDDEN' },
      ] },
    })]);
    expect(p.snapshot.events.at(-1)?.text).toBe('Finished');
    expect(p.snapshot.status).toBe('completed');
    expect(JSON.stringify(p.snapshot)).not.toContain('HIDDEN');
  });
  it('bounds event history and previews, and rejects invalid call IDs', () => {
    const p = parse([meta(), own(), call('\x1b[2J'), ...Array.from({ length: 100 }, (_, i) => message(`${i}: ${'x'.repeat(4000)}`))]);
    expect(p.snapshot.events).toHaveLength(80);
    expect(p.snapshot.limited).toBe(true);
    expect(p.snapshot.events.every(e => e.text.length < 2500 && e.kind === 'message')).toBe(true);
  });
});

describe('preview sanitization', () => {
  it('removes terminal escapes and bidi controls while retaining ordinary text', () => {
    expect(sanitize('\x1b[2Jhello\x1b]0;bad\x07\u202eworld\nnext')).toBe('helloworld\nnext');
  });
  it.each([
    'OPENAI_API_KEY=sk-proj-1234567890123456789',
    '{"password":"sensitive-value"}', 'Authorization: Bearer sensitive-value',
    'https://user:sensitive-value@example.test',
    '-----BEGIN PRIVATE KEY-----\nsensitive-value\n-----END PRIVATE KEY-----',
  ])('masks credentials before clipping: %s', input => {
    expect(sanitize(input)).toContain('REDACTED');
    expect(sanitize(input)).not.toContain('sensitive-value');
    expect(sanitize(input)).not.toContain('sk-proj-1234567890123456789');
  });
  it('keeps benign command output readable', () => {
    expect(sanitize('npm test\n42 passed, 0 errors')).toBe('npm test\n42 passed, 0 errors');
  });
  it('handles long ordinary words and hyphenated output without backtracking over every prefix', () => {
    expect(sanitize('x'.repeat(64000))).toBe('x'.repeat(2400) + ' ... [truncated]');
    expect(sanitize('a-'.repeat(32000))).toBe('a-'.repeat(1200) + ' ... [truncated]');
  }, 1000);
});
