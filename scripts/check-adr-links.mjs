#!/usr/bin/env node
// Checks the 4xx ADRs under v3/docs/adr: no duplicate ADR number, every relative markdown link resolves, and every
// ADR named on a "Builds on / Extends / Supersedes" header line exists. Exit 1 on any finding.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ADR_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'v3', 'docs', 'adr')

// Number -> how many files may share it. 430 has two files (the menu accents ADR and the menu-design amendments);
// renumbering one would break the code comments that cite "ADR-430" for either. New duplicates still fail.
export const KNOWN_DUPLICATES = { 430: 2 }

const FILE = /^ADR-(4\d\d)-.+\.md$/
const RELATION = /^\s*(builds on|extends|supersedes|superseded by|complements)\b[^\n]*/gim

const stripCode = text => text.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '')

export function listAdrs(dir = ADR_DIR) {
  return readdirSync(dir).filter(f => FILE.test(f)).sort().map(f => ({ file: f, number: Number(FILE.exec(f)[1]) }))
}

export function checkDuplicates(adrs, known = KNOWN_DUPLICATES) {
  const byNumber = new Map()
  for (const a of adrs) byNumber.set(a.number, [...(byNumber.get(a.number) ?? []), a.file])
  const out = []
  for (const [n, files] of byNumber) if (files.length > (known[n] ?? 1)) out.push(`duplicate ADR number ${n}: ${files.join(', ')}`)
  return out
}

export function relativeLinks(markdown) {
  const out = []
  for (const m of stripCode(markdown).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1]
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue
    out.push(target.split('#')[0])
  }
  return out.filter(Boolean)
}

export function checkLinks(adrs, dir = ADR_DIR) {
  const out = []
  for (const a of adrs) {
    for (const target of relativeLinks(readFileSync(join(dir, a.file), 'utf8'))) {
      if (!existsSync(resolve(dir, decodeURIComponent(target)))) out.push(`${a.file}: broken relative link ${target}`)
    }
  }
  return out
}

export function relatedNumbers(markdown) {
  const out = []
  for (const m of markdown.matchAll(RELATION)) {
    // "ruOS ADR-043" names another repo's ADR, not one of ours.
    const line = m[0].replace(/\bruOS ADR[- ]?\d+/gi, '')
    for (const n of line.matchAll(/\bADR[- ]?(\d{3})|(?<=\d{3}[A-Z]?\/)(\d{3})\b/g)) out.push(Number(n[1] ?? n[2]))
  }
  return [...new Set(out)]
}

export function checkRelations(adrs, dir = ADR_DIR) {
  const known = new Set(readdirSync(dir).map(f => /^ADR-(\d+)/.exec(f)?.[1]).filter(Boolean).map(Number))
  const out = []
  for (const a of adrs) {
    const header = readFileSync(join(dir, a.file), 'utf8').split('\n').slice(0, 14).join('\n')
    for (const n of relatedNumbers(header)) if (!known.has(n)) out.push(`${a.file}: relation line names ADR ${n}, which has no file`)
  }
  return out
}

export function run(dir = ADR_DIR) {
  const adrs = listAdrs(dir)
  return [...checkDuplicates(adrs), ...checkLinks(adrs, dir), ...checkRelations(adrs, dir)]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = run()
  for (const f of findings) console.error(f)
  console.log(findings.length ? `${findings.length} ADR finding(s)` : `ok: ${listAdrs().length} ADRs checked`)
  process.exit(findings.length ? 1 : 0)
}
