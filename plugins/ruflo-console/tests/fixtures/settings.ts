import { cliAnswer, type Answer } from './world'

/** `claude plugin configure <plugin> --json` as the CLI prints it (shape captured from 2.1.287), trimmed. */
export const CONSOLE_CONFIG = JSON.stringify({
  pluginId: 'ruflo-console@ruflo',
  displayName: 'ruflo-console',
  schema: {
    cli: { type: 'string', title: 'ruflo CLI', description: 'How the console reaches ruflo.', default: 'npx-offline', options: ['npx-offline', 'npx', 'ruflo', 'claude-flow'] },
    refreshSeconds: { type: 'number', title: 'Disk refresh (seconds)', description: 'How often ruflo’s files are re-read (2 to 60).', default: 3 },
    fps: { type: 'number', title: 'Animation frames per second', description: 'Frame cap while the pane is shown (0 to 12).', default: 8 },
    panel: { type: 'string', title: 'Cockpit pane', description: 'auto opens the cockpit at session start.', default: 'auto', options: ['auto', 'command', 'off'] },
    look: { type: 'string', title: 'Look', description: 'bbs draws ANSI-BBS art; plain is text only.', default: 'bbs', options: ['bbs', 'plain'] },
    boot: { type: 'boolean', title: 'Boot screen', description: 'Play the dial-up boot screen when the cockpit opens.', default: true },
  },
  inputs: { cli: 'npx-offline', refreshSeconds: '', fps: '', panel: 'auto', look: 'bbs', boot: 'true' },
  choices: { cli: ['npx-offline', 'npx', 'ruflo', 'claude-flow'], panel: ['auto', 'command', 'off'], look: ['bbs', 'plain'], boot: ['true', 'false'] },
  configured: [],
  unconfigured: ['cli', 'refreshSeconds', 'fps', 'panel', 'look', 'boot'],
})

export const MODS_CONFIG = JSON.stringify({
  pluginId: 'ruflo-mods@ruflo',
  schema: {
    costBudgetUsd: { type: 'number', title: 'Session budget (USD)', description: 'Apply the budget ladder. 0 turns it off.', default: 0 },
    toolHints: { type: 'boolean', title: 'Usage hints on ruflo tools', description: 'schema text that is replaced on screen', default: false },
    agentTrim: { type: 'boolean', title: 'Hide unused agent types', description: 'schema text that is replaced on screen', default: false },
    agentTrimKeep: { type: 'string', title: 'Agent types to never hide', description: 'Comma-separated names.', default: '' },
    deliveryScreen: { type: 'boolean', title: 'Screen peer deliveries and outgoing messages', description: 'schema text that is replaced on screen', default: false },
    modTrustAllow: { type: 'string', title: 'Trusted mods', description: 'Plugin ids to trust.', default: '' },
    relayApiToken: { type: 'string', title: 'Relay token', description: 'A bearer token.', sensitive: true },
  },
  inputs: { costBudgetUsd: '', toolHints: 'false', agentTrim: 'false', agentTrimKeep: '', deliveryScreen: 'false', modTrustAllow: '', relayApiToken: 'sk-must-never-show' },
  choices: { toolHints: ['true', 'false'], agentTrim: ['true', 'false'], deliveryScreen: ['true', 'false'] },
  configured: ['relayApiToken'],
  unconfigured: ['costBudgetUsd', 'modTrustAllow'],
})

const CORE_VALUES: Record<string, string> = { 'swarm.topology': 'hierarchical', 'swarm.maxAgents': '15', 'memory.backend': 'hybrid' }

/** The fake CLI for Settings: plugin option schemas, ruflo config reads, and a quiet ok for the writes. */
export function settingsAnswer(argv: readonly string[]): Answer {
  const line = argv.join(' ')

  if (argv[0] === 'claude' && argv[1] === 'plugin' && argv[2] === 'configure') {
    if (argv.includes('--values-stdin')) return { exitCode: 0, stdout: 'saved', stderr: '' }

    return { exitCode: 0, stdout: argv[3]?.startsWith('ruflo-mods') ? MODS_CONFIG : argv[3]?.startsWith('ruflo-console') ? CONSOLE_CONFIG : '{}', stderr: '' }
  }

  const get = line.match(/config get -k ([a-z.]+)/)

  if (get !== null) return { exitCode: 0, stdout: `${get[1]} = ${CORE_VALUES[get[1] as string] ?? ''}\n`, stderr: '' }

  if (line.includes('config set')) return { exitCode: 0, stdout: 'ok', stderr: '' }

  return cliAnswer(argv)
}
