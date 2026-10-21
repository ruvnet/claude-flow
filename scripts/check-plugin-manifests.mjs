#!/usr/bin/env node
// Static check that mirrors what the claude.ai plugin-upload validator reports.
// Run: node scripts/check-plugin-manifests.mjs [--root plugins]
//
// 1. Unknown top-level keys in .claude-plugin/plugin.json. The SDK strips them on upload.
//    Allowed list source: the fields `claude plugin validate` (Claude Code 2.1.289) accepts at load
//    time (probed key by key), plus `types` (Claude Code's mod type contract; see below), minus the
//    store-listing fields (documentationUrl, icon, privacyPolicyUrl, supportUrl, termsOfServiceUrl),
//    which the local validator accepts but the claude.ai validator strips. Keep that listing data in
//    the plugin README and the directory submission JSON, not in plugin.json.
//    EXCEPTION (verified 2026-10-09 on the claude.ai directory Listing tab for ruflo-ai-team): the
//    directory builds its store listing (icon, documentation, support, privacy, terms) FROM those
//    plugin.json keys, so they are allowlisted below as DIRECTORY_CONSUMED and only reported as notes.
//    The claude.ai upload validator still warns about them; that warning is expected.
// 2. A plugin.json nested under .claude-plugin/ anywhere below a plugin root other than the root
//    manifest (the validator mistakes it for a second plugin). Templates use plugin.json.tmpl.
// 3. XML-looking tags (<word>, </word>) in a SKILL.md frontmatter description: claude.ai strips them.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ALLOWED = new Set([
  'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords',
  'commands', 'agents', 'skills', 'hooks', 'mcpServers', 'outputStyles', 'lspServers', 'userConfig',
  'channels', 'dependencies', 'settings', 'monitors', 'themes', 'displayName',
])
// Known to Claude Code (mod type contract, read by `claude plugin validate` and the engine) but
// stripped by the claude.ai SDK. The only exception: a mod plugin needs it so its `$.<noun>` calls
// are checked against the contract. Never add to this list without a consumer that reads the key.
const CLAUDE_CODE_ONLY = new Set(['types'])
const DIRECTORY_CONSUMED = new Set(['documentationUrl', 'icon', 'privacyPolicyUrl', 'supportUrl', 'termsOfServiceUrl'])

const rootArg = process.argv.indexOf('--root')
const root = rootArg > 0 ? process.argv[rootArg + 1] : join(process.cwd(), 'plugins')
// Plugin roots the marketplace points at below a plugin dir (e.g. ./plugins/ruflo-ai-team/directory):
// each is a real plugin root, so its manifest is checked like any other and is not a "nested" one.
const marketplaceRoots = new Set()
try {
  const mkt = JSON.parse(readFileSync(join(root, '..', '.claude-plugin', 'marketplace.json'), 'utf8'))
  for (const p of mkt.plugins ?? []) if (typeof p.source === 'string') marketplaceRoots.add(p.source.replace(/^\.\//, '').replace(/^plugins\//, ''))
} catch { /* no marketplace next to the plugins dir */ }
const errors = []
const notes = []
const SKIP = new Set(['node_modules', '.git', 'dist'])

function walk(dir, fn) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) { fn(p, true); walk(p, fn) } else fn(p, false)
  }
}

export function frontmatterDescription(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return ''
  const lines = m[1].split(/\r?\n/)
  const i = lines.findIndex((l) => /^description\s*:/.test(l))
  if (i < 0) return ''
  let out = lines[i].replace(/^description\s*:\s*/, '')
  for (let j = i + 1; j < lines.length && /^\s+\S|^\s*$/.test(lines[j]); j++) out += ' ' + lines[j].trim()
  return out
}

for (const plugin of readdirSync(root).sort()) {
  const dir = join(root, plugin)
  if (!statSync(dir).isDirectory()) continue
  const manifests = [['', join(dir, '.claude-plugin', 'plugin.json')]]
  for (const r of marketplaceRoots) if (r.startsWith(plugin + '/')) manifests.push([r.slice(plugin.length + 1) + '/', join(root, r, '.claude-plugin', 'plugin.json')])
  for (const [prefix, manifest] of manifests) {
    if (!existsSync(manifest)) continue
    let json
    try { json = JSON.parse(readFileSync(manifest, 'utf8')) } catch (e) { errors.push(`${plugin}: ${prefix}plugin.json is not valid JSON (${e.message})`); continue }
    for (const key of Object.keys(json)) {
      if (ALLOWED.has(key)) continue
      if (CLAUDE_CODE_ONLY.has(key)) { notes.push(`${plugin}: '${key}' is Claude Code only (claude.ai strips it); kept on purpose`); continue }
      if (DIRECTORY_CONSUMED.has(key)) { notes.push(`${plugin}: '${prefix}${key}' is a directory-consumed store-listing key (claude.ai upload warns; expected)`); continue }
      errors.push(`${plugin}: unknown ${prefix}plugin.json key '${key}'`)
    }
  }
  walk(dir, (p, isDir) => {
    const rel = relative(dir, p).split(sep).join('/')
    const isMarketplaceRoot = [...marketplaceRoots].some((r) => r === `${plugin}/${rel.replace(/\/?\.claude-plugin\/plugin\.json$/, '')}`)
    if (!isDir && /(^|\/)\.claude-plugin\/plugin\.json$/.test(rel) && rel !== '.claude-plugin/plugin.json' && !isMarketplaceRoot) {
      errors.push(`${plugin}: nested manifest ${rel} (validator expects only .claude-plugin/plugin.json at the plugin root)`)
    }
    if (!isDir && /(^|\/)skills\/[^/]+\/SKILL\.md$/.test(rel)) {
      const d = frontmatterDescription(readFileSync(p, 'utf8'))
      const tag = /<\/?[A-Za-z!][^<>]*>/.exec(d)
      if (tag) errors.push(`${plugin}: ${rel} description contains tag-like text '${tag[0]}'`)
    }
  })
}

for (const n of notes) console.log(`note: ${n}`)
if (errors.length) {
  for (const e of errors) console.error(`FAIL: ${e}`)
  console.error(`${errors.length} problem(s)`)
  process.exit(1)
}
console.log('plugin manifests ok')
