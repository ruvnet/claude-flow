/**
 * The Room's own state and actions (ADR-448): a draft, what the person said, and the feed's source filter, search, pause and paging. The
 * three things it can send are existing palette entries run exactly as `/ruflo run <id> <text>` would; each keeps its own confirm.
 */
import { SAID_MAX, SAY_IDS, type RoomSource, type SayId, type Said } from './data/room'
import { plain } from './data/parse'
import type { State } from './state'

export const ROOM_PAGE = 12

export type RoomState = { draft: string; said: Said[]; source: 'all' | RoomSource; query: string; pausedAtMs: number | null; page: number; open: string | null; blocked: boolean; mod: string | null }

const states = new WeakMap<State, RoomState>()

export function roomOf(state: State): RoomState {
  let found = states.get(state)

  if (found === undefined) {
    found = { draft: '', said: [], source: 'all', query: '', pausedAtMs: null, page: 0, open: null, blocked: false, mod: null }
    states.set(state, found)
  }

  return found
}

export type RoomActions = {
  draft: (text: string) => void
  /** Sends the draft through the named action (it asks first, or is refused by the same checks as anywhere else). */
  say: (id: SayId) => void
  source: (source: RoomState['source']) => void
  query: (text: string) => void
  pause: () => void
  page: (by: number) => void
  open: (id: string) => void
  /** Shows only what was refused or failed. */
  blocked: () => void
  /** Opens or closes one mod's detail block. */
  mod: (name: string) => void
}

export function roomActions(state: State, invalidate: () => void, run: (id: string, text: string) => boolean, pageCount: () => number): RoomActions {
  const room = roomOf(state)

  return {
    draft: text => {
      room.draft = plain(text, Number.MAX_SAFE_INTEGER)
      invalidate()
    },
    say: id => {
      const text = room.draft.trim()

      if (!SAY_IDS.includes(id) || text === '') return

      const at = Date.now()

      if (run(id, text)) {
        room.said.push({ atMs: at, id, text, label: state.pending?.label ?? null })
        if (room.said.length > SAID_MAX) room.said.splice(0, room.said.length - SAID_MAX)
        room.draft = ''
      }

      invalidate()
    },
    source: source => {
      room.source = source
      room.page = 0
      invalidate()
    },
    query: text => {
      room.query = plain(text, Number.MAX_SAFE_INTEGER)
      room.page = 0
      invalidate()
    },
    pause: () => {
      room.pausedAtMs = room.pausedAtMs === null ? Date.now() : null
      room.page = 0
      invalidate()
    },
    page: by => {
      room.page = Math.max(0, Math.min(Math.max(0, pageCount() - 1), room.page + by))
      invalidate()
    },
    open: id => {
      room.open = room.open === id ? null : id
      invalidate()
    },
    blocked: () => {
      room.blocked = !room.blocked
      room.page = 0
      invalidate()
    },
    mod: name => {
      room.mod = room.mod === name ? null : plain(name, 48)
      invalidate()
    },
  }
}
