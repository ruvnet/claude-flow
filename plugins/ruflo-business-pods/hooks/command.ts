import { badTemplatePath } from './guard'
import type { ModOptions } from './options'
import { secretsIn } from './screen'
import type { Stats } from './status'

export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats }

const HELP = ['/pods-mod status', '/pods-mod scan <text>', '/pods-mod path <template.json>'].join('\n')

/** `/pods-mod` is answered locally and takes no model turn (the plugin's pod skill is a prompt). Read-only: runs the guard's checks on what you give it. */
export function answer(args: string, { opts, stats }: CommandDeps): string {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  if (verb === '' || verb === 'help') return HELP
  if (verb === 'status') {
    const rules = Object.entries(stats.byRule).map(([k, n]) => `${k} ${n}`).join(', ')
    return [`guard ${opts.guard ? 'on' : 'off'}`, `checked ${stats.checked} · blocked ${stats.blocked}${rules ? ` (${rules})` : ''}`].join('\n')
  }
  if (verb === 'scan') {
    if (arg === '') return 'usage: /pods-mod scan <text>'
    const found = secretsIn(arg)
    return found.length ? `The guard would refuse a template holding that (${found.join(', ')}).` : 'Nothing found: the guard would let that into a template.'
  }
  if (verb === 'path') {
    if (arg === '') return 'usage: /pods-mod path <template.json>'
    const why = badTemplatePath(arg)
    return why === undefined ? 'The guard would let that template path be read.' : `The guard would refuse that template path: it ${why}.`
  }
  return `Unknown: ${verb}\n${HELP}`
}
