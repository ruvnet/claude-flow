/**
 * A transcript with the shapes a real Claude Code one has (ADR-459): a streamed duplicate block, an error result, an array result with an
 * image, an unanswered call, a credential, an escape sequence, a meta line. Content is invented; timestamps are fixed offsets from T0.
 */
import { T0 } from './workflows'

const iso = (s: number): string => new Date(T0 + s * 1000).toISOString()

export const line = (type: 'user' | 'assistant', at: number, content: unknown, extra: Record<string, unknown> = {}): string => JSON.stringify({ type, timestamp: iso(at), message: { role: type, content }, ...extra })
export const use = (id: string, name: string, input: unknown): unknown => ({ type: 'tool_use', id, name, input })
export const back = (id: string, content: unknown, isError = false): unknown => ({ type: 'tool_result', tool_use_id: id, content, ...(isError && { is_error: true }) })

export const SECRET = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX'

export const sample = (root = '/wt'): string =>
  [
    line('user', 0, `do the work, key ${SECRET}`),
    line('assistant', 1, [{ type: 'thinking', thinking: 'plan it' }]),
    line('assistant', 2, [use('t1', 'Bash', { command: 'ls -la', description: 'list' })]),
    line('assistant', 2, [use('t1', 'Bash', { command: 'ls -la', description: 'list' })]),
    line('user', 4, [back('t1', 'total 3\n\u001b[31mred\u001b[0m\nAuthorization: Bearer abcdefghijklmnop')]),
    line('assistant', 5, [use('t2', 'Edit', { file_path: `${root}/a.ts`, old_string: 'x', new_string: 'y' })]),
    line('user', 6, [back('t2', [{ type: 'text', text: 'boom' }, { type: 'image' }], true)]),
    line('assistant', 7, [use('t3', 'Read', { file_path: `${root}/b.ts` }), use('t4', 'Write', { file_path: `${root}/c.ts`, content: 'z' })]),
    line('user', 7.5, 'meta line', { isMeta: true }),
    line('assistant', 9, [{ type: 'text', text: 'all done' }]),
  ].join('\n') + '\n'
