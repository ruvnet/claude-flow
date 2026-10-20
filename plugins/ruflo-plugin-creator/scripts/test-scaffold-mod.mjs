#!/usr/bin/env node
// Scaffold a mod from the template and hold it to `claude plugin validate` and `claude plugin test`.
// Skips (exit 0, says so) when the claude CLI is not installed.
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scaffoldMod } from './scaffold-mod.mjs'

const claude = spawnSync('claude', ['--version'], { encoding: 'utf8' })
if (claude.status !== 0) { console.log('skip: claude CLI not available'); process.exit(0) }

const root = mkdtempSync(join(tmpdir(), 'scaffold-mod-'))
let failed = false
try {
  const dir = scaffoldMod('demo-mod', join(root, 'demo-mod'))
  const manifest = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))
  const check = (label, ok) => { if (!ok) { failed = true; console.error(`FAIL: ${label}`) } else console.log(`ok: ${label}`) }
  check('manifest at .claude-plugin/plugin.json named demo-mod', manifest.name === 'demo-mod')
  check('no plugin.json.tmpl left behind', !existsSync(join(dir, 'plugin.json.tmpl')))
  check('no my-mod / MY_MOD left', !/my-mod|MY_MOD/.test(readFileSync(join(dir, 'hooks', 'register.ts'), 'utf8')))
  for (const sub of ['validate', 'test']) {
    const r = spawnSync('claude', ['plugin', sub, dir], { encoding: 'utf8' })
    check(`claude plugin ${sub}`, r.status === 0)
    if (r.status !== 0) console.error((r.stdout || '') + (r.stderr || ''))
    if (sub === 'validate') check('claude plugin validate reports no warnings', !/⚠|warning/i.test(r.stdout || ''))
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
