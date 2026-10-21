import { badUrl, exfiltrates } from './guard'
import type { ModOptions } from './options'
import type { Stats } from './status'

export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats }

const HELP = ['/browser-mod status', '/browser-mod scan <js>', '/browser-mod url <url>'].join('\n')

/** `/browser-mod` is answered locally and takes no model turn (the plugin's `/ruflo-browser` is a prompt command). Read-only. */
export function answer(args: string, { opts, stats }: CommandDeps): string {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  if (verb === '' || verb === 'help') return HELP
  if (verb === 'status') {
    const rules = Object.entries(stats.byRule).map(([k, n]) => `${k} ${n}`).join(', ')
    return [`guard ${opts.guard ? 'on' : 'off'} · strict urls ${opts.strictUrls ? 'on' : 'off'}`, `checked ${stats.checked} · blocked ${stats.blocked}${rules ? ` (${rules})` : ''}`].join('\n')
  }
  if (verb === 'scan') {
    if (arg === '') return 'usage: /browser-mod scan <js>'
    return exfiltrates(arg) ? 'The guard would refuse that script: it reads cookies or storage and can send them off the page.' : 'Nothing found: the guard would let that script run.'
  }
  if (verb === 'url') {
    if (arg === '') return 'usage: /browser-mod url <url>'
    const why = badUrl(arg, opts.strictUrls)
    return why === undefined ? 'The guard would let that URL open.' : `The guard would refuse that URL: it ${why}.`
  }
  return `Unknown: ${verb}\n${HELP}`
}
