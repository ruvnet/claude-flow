import { secretsIn } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

const HELP = ['/migrations-mod status', '/migrations-mod scan <sql>'].join('\n')

// Read-only lint: statements that lose data and belong only in a reviewed, dry-run down migration.
const DESTRUCTIVE: readonly (readonly [string, RegExp])[] = [
  ['drop table, schema or database', /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i],
  ['truncate', /\bTRUNCATE\b/i],
  ['drop column', /\bALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b/i],
  ['delete without where', /\bDELETE\s+FROM\s+[\w."`]+\s*(?:;|$)/im],
]

/** `/migrations-mod` is answered locally and takes no model turn. */
export function answer(args: string, opts: ModOptions, stats: Stats): string {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return [`guard ${opts.guard ? 'on' : 'off'}`, `checked ${stats.checked} · blocked ${stats.blocked}${stats.lastBlock ? ` · last: ${stats.lastBlock}` : ''}`].join('\n')
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /migrations-mod scan <sql>'
    const lost = DESTRUCTIVE.filter(([, re]) => re.test(arg)).map(([name]) => name)
    const secrets = secretsIn(arg)
    const parts = [lost.length ? `destructive: ${lost.join(', ')}` : '', secrets.length ? `secrets: ${secrets.join(', ')}` : ''].filter(Boolean)
    return parts.length ? `Review before applying (${parts.join('; ')}).` : 'Nothing destructive or secret-shaped found.'
  }

  return `Unknown: ${verb}\n${HELP}`
}
