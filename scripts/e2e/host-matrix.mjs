#!/usr/bin/env node
// Three-host e2e loop (ADR-490): Claude Code, Codex and OpenRouter against the real ruflo CLI/MCP/mods, host x assertion matrix.
//   node scripts/e2e/host-matrix.mjs                          keyless + stubbed assertions only (what CI runs): $0, no model call
//   RUFLO_E2E_LIVE=1 node scripts/e2e/host-matrix.mjs --live  also run the live legs (spend-incurring, capped at --cap USD, default 6)
// Flags: --legs claude,codex,openrouter,tui  --cli-version latest|X.Y.Z  --cli-path <repo cli.js>  --json out.json  --cap 6
import { writeFileSync } from 'node:fs'
import { spend, renderTable, redact } from './lib.mjs'
import { claudeLeg } from './leg-claude.mjs'
import { codexLeg } from './leg-codex.mjs'
import { openrouterLeg } from './leg-openrouter.mjs'
import { tuiLeg } from './leg-tui.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const live = process.argv.includes('--live') && process.env.RUFLO_E2E_LIVE === '1'
if (process.argv.includes('--live') && !live) console.error('--live ignored: set RUFLO_E2E_LIVE=1 as well (spend guard)')
spend.cap = Number(arg('cap', '6'))
const cliPath = arg('cli-path', process.env.RUFLO_E2E_CLI_PATH)
const cli = cliPath ? { cmd: process.execPath, args: [cliPath], label: `path:${cliPath}` } : { cmd: 'npx', args: ['-y', `ruflo@${arg('cli-version', process.env.RUFLO_E2E_CLI_VERSION ?? 'latest')}`], label: `ruflo@${arg('cli-version', process.env.RUFLO_E2E_CLI_VERSION ?? 'latest')}` }
const legs = (arg('legs', 'claude,codex,openrouter,tui')).split(',')
const ctx = { cli, live, spend }
const fns = { claude: claudeLeg, codex: codexLeg, openrouter: openrouterLeg, tui: tuiLeg }

const rows = []
for (const leg of legs) {
  if (!fns[leg]) { console.error(`unknown leg ${leg}`); process.exit(2) }
  const t0 = Date.now()
  try { rows.push(...await fns[leg](ctx)) } catch (e) { rows.push({ leg, name: 'leg ran to completion', status: 'fail', evidence: redact(String(e?.stack ?? e)).slice(0, 400) }) }
  console.error(`# ${leg} done in ${Math.round((Date.now() - t0) / 1000)}s`)
}
console.log(renderTable(rows))
const n = s => rows.filter(r => r.status === s).length
console.log(`\ncli=${cli.label} live=${live} pass=${n('pass')} fail=${n('fail')} blocked=${n('blocked')} skipped=${n('skipped')} advisory=${n('advisory')} flaky=${n('flaky')} spend_usd=${spend.usd.toFixed(4)}/${spend.cap}`)
if (arg('json')) writeFileSync(arg('json'), `${redact(JSON.stringify({ cli: cli.label, live, spend: spend.usd, rows }, null, 2))}\n`)
process.exit(n('fail') ? 1 : 0)
