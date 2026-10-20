import type { Plugin } from 'claude-code/testing'

/**
 * Another mod using `$.ruflo` the way ruOS and ruflo-ruos do: from its own
 * hooks. `/consumer <json>` calls the method named in the JSON and answers
 * what it resolved to, or `error: <message>` when the call rejected.
 */
export const consumer: Plugin = {
  name: 'consumer',
  tier: 'user',
  register: on => {
    on('command.run', { command: 'consumer-segment' }, async ($, e) => {
      const input = JSON.parse(e.args) as { id: string; text: string | null }
      try {
        await $.ruflo.segment(input)
        return { text: 'ok' }
      } catch (error) {
        return { text: `error: ${String((error as Error)?.message ?? error)}` }
      }
    })
    on('command.run', { command: 'consumer-last-route' }, async $ => ({ text: JSON.stringify(await $.ruflo.lastRoute()) }))
    on('command.run', { command: 'consumer-snapshot' }, async $ => ({ text: JSON.stringify(await $.ruflo.snapshot()) }))
  },
}

const PRESENTATION = { isFullscreen: false, columns: 100 }
export const run = (command: string, args = '') => ({ command, args, origin: { kind: 'composer' as const }, presentation: PRESENTATION })
