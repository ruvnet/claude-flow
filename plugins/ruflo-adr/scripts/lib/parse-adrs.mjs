// Shared ADR file-scan + parse logic for the ruflo-adr plugin scripts
// (import.mjs, reindex.mjs). Extracted from import.mjs (#2666) so a
// full reconcile (reindex.mjs) doesn't duplicate ~150 lines of dual-format
// (v3-style / plugin-style frontmatter) parsing and drift out of sync with it.
//
// Pure functions only — no memory_store / subprocess calls live here. Callers
// own persistence.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

// #2474 bonus: `.claude/worktrees/*` mirrors the repo so every ADR was
// indexed 2-3x. Skip the whole `.claude` tree — it's all ruflo runtime
// state (worktrees, scheduled tasks, etc.), never authored content.
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'v2', '.next', '.turbo', 'build', '.claude']);

// #2474 Bug 4: parseId padded ADR numbers, but extractAdrRefs's
// padStart-then-strip pipeline produced different results for the same
// numeric value. A repo mixing `0001-foo.md` (parseId → ADR-0001) with
// a body line `Supersedes: ADR-0001` (extractAdrRefs → ADR-001) drops
// every edge as dangling. Single normalizer keeps both paths in lockstep.
export function normalizeAdrId(raw) {
  const digits = String(raw).replace(/^ADR-?/i, '').trim();
  if (!/^\d+$/.test(digits)) return `ADR-${raw}`;
  // Canonical form: ≤3 digits → zero-pad to 3 (legacy default);
  // ≥4 digits → keep as-is. Either way, the same numeric input from
  // a filename and from a body reference now produce the same key.
  return digits.length >= 4 ? `ADR-${digits}` : `ADR-${digits.padStart(3, '0')}`;
}

export function findAdrs(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      findAdrs(p, out);
    } else if (e.endsWith('.md') && (p.includes('/docs/adr/') || p.includes('/docs/adrs/'))) {
      out.push(p);
    }
  }
  return out;
}

export function parseAdr(path, root) {
  const text = readFileSync(path, 'utf-8');
  const id = parseId(path, text);
  const title = parseTitle(text);
  const status = parseStatus(text);
  const date = parseDate(text);
  const tags = parseTags(text);
  const context = parseContextFirstParagraph(text);
  const links = parseLinks(text, id);
  return { id, title, status, date, tags, context, links, file: path.replace(root + '/', '') };
}

function parseId(path, text) {
  const fm = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
  if (fm) {
    const m = /^id:\s*(\S+)/m.exec(fm[1]);
    if (m) return normalizeAdrId(m[1]);
  }
  const fname = basename(path, '.md');
  const m = /^(ADR-?\d+|\d{3,4})/i.exec(fname);
  if (m) return normalizeAdrId(m[1]);
  return fname;
}

function parseTitle(text) {
  const fm = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
  if (fm) {
    const m = /^title:\s*(.+)$/m.exec(fm[1]);
    if (m) return m[1].trim();
  }
  const m = /^#\s*(?:ADR-?\d+:?\s*)?(.+?)$/m.exec(text);
  return m ? m[1].trim() : '(untitled)';
}

function parseStatus(text) {
  const fm = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
  if (fm) {
    const m = /^status:\s*(.+)$/im.exec(fm[1]);
    if (m) return m[1].trim();
  }
  // #2474 Bug 2: also accept `**Status:**` (colon inside the bold span),
  // the widely-used Nygard / MADR style. Previous regex only matched
  // `**Status**:` (colon outside) and dropped every Nygard-style ADR
  // to status=Unknown. Now the colon can sit on either side of the `**`.
  // Strip parenthetical qualifiers like "Proposed (v3.6.x)" -> "Proposed".
  let m = /^\*\*Status:?\*\*:?\s*([A-Za-z][A-Za-z\- ]*?)(?:\s*\(.*?\))?\s*$/m.exec(text);
  if (m) return m[1].trim();
  // Also handle full-bold MADR style: **Status: Value** (entire phrase bolded)
  m = /^\*\*Status:\s*([A-Za-z][A-Za-z\- ]*?)(?:\s*\([^)]*\))?\*\*\s*$/m.exec(text);
  return m ? m[1].trim() : 'Unknown';
}

function parseDate(text) {
  const fm = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
  if (fm) {
    const m = /^date:\s*(\S+)/m.exec(fm[1]);
    if (m) return m[1];
  }
  const m = /^\*\*Date\*\*:\s*(\S+)/m.exec(text);
  return m ? m[1] : '';
}

function parseTags(text) {
  const fm = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
  if (fm) {
    const m = /^tags:\s*\[([^\]]+)\]/m.exec(fm[1]);
    if (m) return m[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  const m = /^\*\*Tags\*\*:\s*(.+)$/m.exec(text);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function parseContextFirstParagraph(text) {
  const m = /^##\s*Context\s*$\s*([\s\S]+?)(?=^##\s|\Z)/m.exec(text);
  if (!m) return '';
  return m[1].trim().split(/\n\s*\n/)[0].replace(/\s+/g, ' ').slice(0, 400);
}

// Extract ADR-NNN references from a link line. CRITICAL: must distinguish ADR
// references from GitHub issue numbers (#1697 etc.) which the prior version
// false-positively captured as "ADR-1697". We only recognize bare numbers as
// ADR refs when they appear in a known ADR-link section AND they don't look
// like GitHub issues (no leading #, no leading "issue").
function parseLinks(text, selfId) {
  const out = [];
  // Frontmatter relationships
  const fm = /^---\s*$([\s\S]*?)^---\s*$/m.exec(text);
  if (fm) {
    for (const [field, relation] of [
      ['supersedes', 'supersedes'],
      ['amended-by', 'amends'],
      ['amends', 'amends'],
      ['related', 'related'],
      ['depends-on', 'depends-on'],
    ]) {
      const re = new RegExp(`^${field}:\\s*\\[?([^\\]\\n]+)\\]?$`, 'mi');
      const m = re.exec(fm[1]);
      if (m) for (const ref of extractAdrRefs(m[1])) {
        if (relation === 'supersedes') out.push({ from: ref, to: selfId, relation });
        else out.push({ from: selfId, to: ref, relation });
      }
    }
  }
  // Body relationship lines. #2474 Bug 3: loosened to accept both colon
  // placements (`**Supersedes:**` and `**Supersedes**:`) and an optional
  // parenthetical qualifier like `**Supersedes (partial):**` — same
  // tolerance as parseStatus.
  const REL = (label) => new RegExp(`^\\*\\*${label}(?:\\s*\\([^)]*\\))?:?\\*\\*:?\\s*(.+)$`, 'mi');
  const supersedes = REL('Supersedes').exec(text);
  if (supersedes) for (const ref of extractAdrRefs(supersedes[1])) out.push({ from: ref, to: selfId, relation: 'supersedes' });
  const amended = REL('(?:Amended[ -]by|Amends)').exec(text);
  if (amended) for (const ref of extractAdrRefs(amended[1])) out.push({ from: selfId, to: ref, relation: 'amends' });
  const related = REL('Related').exec(text);
  if (related) for (const ref of extractAdrRefs(related[1])) out.push({ from: selfId, to: ref, relation: 'related' });
  const dependsOn = REL('Depends[ -]on').exec(text);
  if (dependsOn) for (const ref of extractAdrRefs(dependsOn[1])) out.push({ from: selfId, to: ref, relation: 'depends-on' });
  return out;
}

export function extractAdrRefs(s) {
  const refs = new Set();
  // Strip GitHub issue / commit references first to prevent false positives.
  const cleaned = s
    .replace(/#\d+/g, '')               // #1697
    .replace(/issue[s]?\s*\d+/gi, '')    // issue 1697
    .replace(/PR\s*\d+/gi, '')           // PR 1234
    .replace(/commit\s*[`a-f0-9]+/gi, '') // commit `abc123`
    .replace(/`[^`]*`/g, '');             // any backtick-quoted span
  const re = /\bADR-?(\d+)\b/gi;
  let m;
  // #2474 Bug 4: route every ADR ref through the same normalizer parseId
  // uses, so a Supersedes: ADR-0001 line lands on the same node key as
  // the file ADR-0001.md (was: padStart-then-strip produced ADR-001).
  while ((m = re.exec(cleaned))) refs.add(normalizeAdrId(m[1]));
  return [...refs];
}
