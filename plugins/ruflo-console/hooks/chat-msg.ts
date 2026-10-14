import type { SessionMessage } from 'claude-code'

/**
 * One turn of the live conversation as the console shows it. `tools` holds tool NAMES only: tool inputs and tool result bodies are
 * dropped here, so transcript detail never reaches disk, console_state text or a model.
 */
export type ChatMsg = { role: 'user' | 'assistant'; text: string; tools: string[] }

/**
 * Maps engine rows to ChatMsg: role and text kept, `toolUses` reduced to names, `toolResults` and every other field dropped.
 *
 * A row with nothing to draw is dropped here, before the store keeps its newest 200: every tool result rides a user row with no text of its
 * own (and an assistant row can be empty), so in a tool loop those rows would each draw an empty "you" frame and eat the kept and drawn
 * slots. A tool-only assistant row stays ("… used <tools>"). Filtering at the mapping (not in keepChat) keeps keepChat touching only the
 * kept tail, and this pass already visits every row.
 */
export function toChatMsgs(rows: readonly SessionMessage[]): ChatMsg[] {
  return rows.flatMap(row => {
    const text = typeof row.text === 'string' ? row.text : ''
    const tools = (row.toolUses ?? []).map(use => use.tool)

    return (row.role === 'user' && text.trim() === '') || (row.role === 'assistant' && text.trim() === '' && tools.length === 0) ? [] : [{ role: row.role, text, tools }]
  })
}
