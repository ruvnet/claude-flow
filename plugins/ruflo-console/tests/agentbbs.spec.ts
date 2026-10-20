/**
 * The AgentBBS rows of the x.ruv.io board, pure: the argument parsers lifted from the tool schemas, what runs at once,
 * what asks, and what is typed into a terminal instead of run. Run with
 *   npx vitest run plugins/ruflo-console/tests/agentbbs.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { newState } from '../hooks/state'
import { bbsPeerArg, bbsPublishArg, bbsSyncArg, bbsWatchArg, XRUV } from '../hooks/xruv'

const KEY = 'c0ffee'.repeat(10) + 'beef'
const NODE = '0123456789abcdef'
const entry = (id: string) => {
  const found = XRUV.find(candidate => candidate.id === id)

  if (found === undefined) throw new Error(`no entry ${id}`)

  return found
}
const params = (args: readonly string[] | undefined) => JSON.parse(args?.[5] ?? 'null') as unknown

describe('agentbbs rows', () => {
  it('a room label registers, a malformed one does not', () => {
    expect(params(entry('x-bbs-register').spec(newState({}), '#sales')?.args)).toEqual({ roomLabel: '#sales' })
    expect(entry('x-bbs-register').spec(newState({}), 'bad;label')).toBeNull()
    expect(entry('x-bbs-register').spec(newState({}), '')).toBeNull()
  })

  it('publish needs a room id and a body; the type defaults to Status', () => {
    expect(bbsPublishArg('room1 Alert: disk full')).toEqual({ roomId: 'room1', msgType: 'Alert', payload: expect.anything() })
    expect(bbsPublishArg('room1 just words')?.msgType).toBe('Status')
    expect(bbsPublishArg('room1')).toBeNull()
    expect(bbsPublishArg('bad$room hi')).toBeNull()
    expect(entry('x-bbs-publish').spec(newState({}), 'room1')).toBeNull()
  })

  it('watch takes a limit from 1 to 500 and reads at once', () => {
    expect(bbsWatchArg('room1')).toEqual({ roomId: 'room1', limit: 20 })
    expect(bbsWatchArg('room1 500')?.limit).toBe(500)
    expect(bbsWatchArg('room1 501')).toBeNull()
    expect(bbsWatchArg('room1 0')).toBeNull()
    expect(entry('x-bbs-watch').spec(newState({}), 'room1 5')?.isReadOnly).toBe(true)
  })

  it('a pinned peer needs a 16-hex node id, an http(s) url and a 64-hex key', () => {
    expect(bbsPeerArg(`${NODE} http://100.1.2.3:7777/ ${KEY} desk box`)).toEqual({ nodeId: NODE, url: 'http://100.1.2.3:7777', publicKey: KEY, label: 'desk box' })
    expect(bbsPeerArg(`${NODE} ftp://host ${KEY}`)).toBeNull()
    expect(bbsPeerArg(`${NODE.slice(1)} http://h ${KEY}`)).toBeNull()
    expect(bbsPeerArg(`${NODE} http://h ${KEY.slice(1)}`)).toBeNull()
    expect(bbsPeerArg(`${NODE} http://user@h ${KEY}`)).toBeNull()
  })

  it('sync is the only row that says it uses the network; serve is typed in a terminal, not run', () => {
    expect(bbsSyncArg(`room1 ${NODE}`)).toEqual({ roomId: 'room1', nodeId: NODE })
    expect(bbsSyncArg('room1 nothex')).toBeNull()
    expect(entry('x-bbs-sync').spec(newState({}), 'room1')?.note).toContain('network')
    expect(entry('x-bbs-register').spec(newState({}), '#a')?.note).toContain('local')
    expect(entry('x-bbs-serve').spec(newState({}), '')).toBeNull()
    expect(entry('x-bbs-serve').why(newState({}), '')).toContain('127.0.0.1')
  })
})
