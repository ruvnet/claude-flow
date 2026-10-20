/**
 * The agents' streamed JSON, one event per line, read into what the terminal shows: the answer as it is typed, each
 * tool or command the agent runs, its session id (so the next question resumes the conversation), and what the turn
 * cost. `codex exec --json` and `claude -p --output-format stream-json` each have their own events; anything not
 * named here is skipped. Every string is the agent's and is drawn as data.
 */
import { plain } from './data/parse'
import type { TermLine } from './state'

export type Sink = {
  line: (kind: TermLine['kind'], text: string) => void
  /** Answer text arriving piece by piece: appended to the open answer line; a newline opens the next. */
  type: (text: string) => void
  session: (id: string) => void
  done: (note: { costUsd?: number; tokens?: number; isError?: boolean; message?: string }) => void
}

const rec = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
/** One cleaned line: no escape sequence, bidi or tag character survives (the agent's text may be hostile), whitespace collapsed. */
const clip = (text: string, max: number): string => plain(text, max)

/** One JSON event per line; a line that is not an object is not an event. */
export function eventOf(line: string): Record<string, unknown> | null {
  const text = line.trim()

  if (!text.startsWith('{') || text.length > 1_000_000) return null

  try {
    return rec(JSON.parse(text))
  } catch {
    return null
  }
}

/** What a tool call was about, in a few words: the command, the file, the pattern or the URL it was given. */
function about(input: unknown): string {
  const args = rec(input)

  if (args === null) return ''

  const pick = str(args.command) ?? str(args.file_path) ?? str(args.path) ?? str(args.pattern) ?? str(args.url) ?? str(args.query) ?? str(args.description) ?? str(args.prompt)

  return pick === undefined ? '' : ` ${clip(pick, 90)}`
}

/** codex exec --json: thread.started, item.started/completed (messages, commands, file changes, tools), turn.completed. */
export function codexEvent(event: Record<string, unknown>, sink: Sink): void {
  const item = rec(event.item)

  switch (event.type) {
    case 'thread.started': {
      const id = str(event.thread_id)

      if (id !== undefined) sink.session(id)

      return
    }
    case 'item.started':
      if (item?.type === 'command_execution' && str(item.command) !== undefined) sink.line('tool', `$ ${clip(item.command as string, 120)}`)

      return
    case 'item.completed':
      if (item === null) return

      switch (item.type) {
        case 'agent_message':
          if (str(item.text) !== undefined) sink.line('out', item.text as string)
          break
        case 'reasoning':
          if (str(item.text) !== undefined) sink.line('sys', `thinking: ${clip(item.text as string, 140)}`)
          break
        case 'command_execution': {
          const code = num(item.exit_code)
          const output = (str(item.aggregated_output) ?? '').split('\n').filter(line => line.trim() !== '')

          for (const line of output.slice(-4)) sink.line('tool', `  ${line}`)
          if (code !== undefined && code !== 0) sink.line('err', `  exit ${code}`)
          break
        }
        case 'file_change':
          for (const change of Array.isArray(item.changes) ? item.changes.slice(0, 8) : []) {
            const entry = rec(change)

            sink.line('tool', `✎ ${str(entry?.kind) ?? 'change'} ${str(entry?.path) ?? ''}`)
          }
          break
        case 'mcp_tool_call':
          sink.line('tool', `⚙ ${str(item.server) ?? 'mcp'}.${str(item.tool) ?? 'tool'}`)
          break
        case 'web_search':
          sink.line('tool', `🔎 ${clip(str(item.query) ?? '', 100)}`)
          break
        case 'todo_list':
          for (const todo of Array.isArray(item.items) ? item.items.slice(0, 8) : []) {
            const entry = rec(todo)

            sink.line('tool', `${entry?.completed === true ? '☑' : '☐'} ${clip(str(entry?.text) ?? '', 100)}`)
          }
          break
        case 'error':
          sink.line('err', clip(str(item.message) ?? 'error', 200))
          break
      }

      return
    case 'turn.completed': {
      const usage = rec(event.usage)
      const tokens = (num(usage?.input_tokens) ?? 0) + (num(usage?.output_tokens) ?? 0)

      sink.done(tokens > 0 ? { tokens } : {})

      return
    }
    case 'turn.failed':
      sink.done({ isError: true, message: clip(str(rec(event.error)?.message) ?? 'turn failed', 200) })

      return
    case 'error':
      sink.line('err', clip(str(event.message) ?? 'error', 200))
  }
}

/**
 * claude -p --output-format stream-json --include-partial-messages: system/init carries the session id, stream_event
 * text deltas are the answer as it is typed, assistant messages carry the tool calls, result the cost. A message whose
 * text never came as deltas (an older CLI) is written out whole when it arrives.
 */
export function claudeParser(): (event: Record<string, unknown>, sink: Sink) => void {
  let hasDeltas = false

  return (event, sink) => {
    switch (event.type) {
      case 'system': {
        const id = str(event.session_id)

        if (event.subtype === 'init' && id !== undefined) sink.session(id)

        return
      }
      case 'stream_event': {
        const inner = rec(event.event)
        const delta = rec(inner?.delta)

        if (inner?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
          hasDeltas = true
          sink.type(delta.text)
        }

        return
      }
      case 'assistant': {
        const content = rec(event.message)?.content

        for (const block of Array.isArray(content) ? content : []) {
          const part = rec(block)

          if (part?.type === 'tool_use') sink.line('tool', `⚙ ${str(part.name) ?? 'tool'}${about(part.input)}`)
          else if (part?.type === 'text' && !hasDeltas && str(part.text) !== undefined) sink.line('out', part.text as string)
        }

        hasDeltas = false

        return
      }
      case 'user': {
        const content = rec(event.message)?.content

        for (const block of Array.isArray(content) ? content : []) {
          const part = rec(block)

          if (part?.type === 'tool_result' && part.is_error === true) sink.line('err', `  ${clip(typeof part.content === 'string' ? part.content : 'tool error', 160)}`)
        }

        return
      }
      case 'result': {
        const cost = num(event.total_cost_usd)

        sink.done({
          ...(cost !== undefined && { costUsd: cost }),
          ...(event.is_error === true && { isError: true, message: clip(str(event.result) ?? str(event.subtype) ?? 'error', 200) }),
        })
      }
    }
  }
}
