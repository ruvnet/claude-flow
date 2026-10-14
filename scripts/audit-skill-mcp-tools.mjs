#!/usr/bin/env node
/**
 * Skill ↔ MCP tool reference audit. Sibling of scripts/audit-cli-mcp-tools.mjs (#1916).
 *
 * Skills tell Claude which ruflo MCP tools to call, in prose and in their
 * `allowed-tools` frontmatter:
 *   - `mcp__claude-flow__<tool>`              (skills copied by `ruflo init`)
 *   - `mcp__plugin_ruflo-core_ruflo__<tool>`  (Claude Code marketplace plugins)
 * A reference to a tool the CLI never registers fails at call time
 * (`MCP tool not found`) or silently grants nothing in `allowed-tools`.
 *
 * This guard scans every SKILL.md that ships to users:
 *   - v3/@claude-flow/cli/.claude/skills/**  (npm package, installed by init)
 *   - plugins/**                             (marketplace plugins)
 * and checks each referenced tool name against the registry that
 * `mcp-client.ts` assembles, resolved the same way audit-cli-mcp-tools.mjs
 * resolves it (the `registerTools([ ... ])` spreads and their imports).
 *
 * Existing dangling references are carried in
 * verification/skill-mcp-tool-baseline.json as `<skill path>::<tool>`
 * entries. Like scripts/ci-test-ratchet.mjs the baseline is identity-based:
 * a reference that is not in it fails, even if the total count is unchanged.
 * Fixed entries never fail; they print a reminder to lower the floor.
 *
 * Usage:
 *   node scripts/audit-skill-mcp-tools.mjs                    # exit 1 on a NEW dangling reference
 *   node scripts/audit-skill-mcp-tools.mjs --json             # machine-readable report
 *   node scripts/audit-skill-mcp-tools.mjs --update-baseline  # after fixing some (never to hide new ones)
 */

import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Skill trees that ship to users, relative to the repo root. */
export const SKILL_ROOTS = ['v3/@claude-flow/cli/.claude/skills', 'plugins'];

/** MCP server prefixes that resolve to the ruflo CLI tool registry. */
const RUFLO_REF_RE = /mcp__(?:claude-flow|plugin_ruflo-core_ruflo)__([A-Za-z0-9_-]+)(\*?)/g;

/**
 * Names that are deliberately not real tools: the scaffold example in
 * plugins/ruflo-plugin-creator/skills/create-plugin/SKILL.md uses
 * `tool1`/`tool2` as placeholders.
 */
export const PLACEHOLDER_TOOLS = new Set(['tool1', 'tool2']);

// A tool definition is `name: '<tool>',` followed by `description:` on the next
// line. Descriptions use all three quote styles (the federation_bbs_* tools in
// agentbbs-tools.ts use "..." and `...`), so accept any of them; matching only
// single quotes would report those registered tools as dangling.
const TOOL_DEF_RE = /name:\s*'([^']+)',\s*\n\s*description:\s*['"`]/g;

function toPosix(path) {
  return path.split(sep).join('/');
}

function cliSrc(repoRoot) {
  return join(repoRoot, 'v3', '@claude-flow', 'cli', 'src');
}

/** Same resolution as audit-cli-mcp-tools.mjs: '.js' import specifiers map to '.ts' sources. */
function resolveImportPath(repoRoot, spec) {
  const p = spec.replace(/^\.\//, '').replace(/\.js$/, '.ts');
  return join(cliSrc(repoRoot), p);
}

/** Files whose tool arrays are spread into `registerTools([ ... ])` in mcp-client.ts. */
export function registeredToolSourceFiles(repoRoot = DEFAULT_REPO_ROOT) {
  const mcpClient = join(cliSrc(repoRoot), 'mcp-client.ts');
  const src = readFileSync(mcpClient, 'utf8');
  const block = (src.match(/registerTools\(\[([\s\S]*?)\]\);/) || [, ''])[1];
  const idents = new Set();
  for (const m of block.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)\s*\(?\s*\)?/g)) idents.add(m[1]);
  const files = new Set();
  for (const id of idents) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const im = src.match(new RegExp(`import\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`));
    if (im) {
      const file = resolveImportPath(repoRoot, im[1]);
      if (existsSync(file)) files.add(file);
      continue;
    }
    // `...getXTools()` factories: guess mcp-tools/<x>-tools.ts, as the sibling audit does.
    const guess = id.replace(/^get/, '').replace(/^([A-Z])/, (c) => c.toLowerCase()).replace(/([A-Z])/g, '-$1').toLowerCase();
    const candidate = join(cliSrc(repoRoot), 'mcp-tools', `${guess}.ts`);
    if (existsSync(candidate)) files.add(candidate);
  }
  return [...files];
}

/** Every tool name the CLI registers. */
export function registeredToolNames(repoRoot = DEFAULT_REPO_ROOT) {
  const names = new Set();
  for (const file of registeredToolSourceFiles(repoRoot)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(TOOL_DEF_RE)) names.add(m[1]);
  }
  return names;
}

/** Ruflo MCP tool references in one SKILL.md body: [{ tool, line }]. */
export function skillToolRefs(text) {
  const refs = [];
  for (const m of text.matchAll(RUFLO_REF_RE)) {
    const [, tool, star] = m;
    if (star || PLACEHOLDER_TOOLS.has(tool)) continue;
    refs.push({ tool, line: text.slice(0, m.index).split('\n').length });
  }
  return refs;
}

function walkSkillFiles(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSkillFiles(full, out);
    else if (entry.isFile() && entry.name === 'SKILL.md') out.push(full);
  }
  return out;
}

/** Every shipped SKILL.md, as repo-relative POSIX paths, sorted. */
export function shippedSkillFiles(repoRoot = DEFAULT_REPO_ROOT) {
  const files = [];
  for (const root of SKILL_ROOTS) walkSkillFiles(join(repoRoot, root), files);
  return files.map((f) => toPosix(relative(repoRoot, f))).sort();
}

/** Dangling references across shipped skills: [{ file, tool, line, key }]. */
export function findDanglingRefs(repoRoot = DEFAULT_REPO_ROOT, registered = registeredToolNames(repoRoot)) {
  const dangling = [];
  for (const file of shippedSkillFiles(repoRoot)) {
    const text = readFileSync(join(repoRoot, file), 'utf8');
    for (const ref of skillToolRefs(text)) {
      if (!registered.has(ref.tool)) dangling.push({ file, tool: ref.tool, line: ref.line, key: `${file}::${ref.tool}` });
    }
  }
  return dangling;
}

/**
 * Compare current dangling references with the baseline entries.
 * ok is false only when a reference is not already in the baseline.
 */
export function evaluateAgainstBaseline(dangling, baselineEntries) {
  const known = new Set(baselineEntries);
  const current = [...new Set(dangling.map((d) => d.key))].sort();
  const currentSet = new Set(current);
  const unexpected = current.filter((key) => !known.has(key));
  const fixed = [...known].filter((key) => !currentSet.has(key)).sort();
  return { ok: unexpected.length === 0, current, unexpected, fixed };
}

export function baselinePath(repoRoot = DEFAULT_REPO_ROOT) {
  return join(repoRoot, 'verification', 'skill-mcp-tool-baseline.json');
}

export function readBaseline(repoRoot = DEFAULT_REPO_ROOT) {
  const file = baselinePath(repoRoot);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed.knownDangling) ? parsed.knownDangling : [];
}

function main(argv) {
  const repoRoot = DEFAULT_REPO_ROOT;
  const registered = registeredToolNames(repoRoot);
  const dangling = findDanglingRefs(repoRoot, registered);

  if (argv.includes('--update-baseline')) {
    const knownDangling = [...new Set(dangling.map((d) => d.key))].sort();
    const next = {
      _comment: 'Monotone-decreasing baseline of shipped SKILL.md files that reference a ruflo MCP tool not registered by mcp-client.ts (entries are <skill path>::<tool>). Fix one, then re-run with --update-baseline to lower the floor. NEVER add entries to hide a new reference.',
      danglingCount: knownDangling.length,
      knownDangling,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(baselinePath(repoRoot), JSON.stringify(next, null, 2) + '\n', 'utf8');
    console.log(`baseline updated → ${knownDangling.length} dangling skill reference(s)`);
    return 0;
  }

  const result = evaluateAgainstBaseline(dangling, readBaseline(repoRoot));
  if (argv.includes('--json')) {
    console.log(JSON.stringify({
      registeredToolCount: registered.size,
      skillFilesScanned: shippedSkillFiles(repoRoot).length,
      danglingCount: result.current.length,
      unexpected: result.unexpected,
      fixed: result.fixed,
      dangling: dangling.map((d) => ({ tool: d.tool, where: `${d.file}:${d.line}` })),
    }, null, 2));
    return result.ok ? 0 : 1;
  }

  console.log(`Skill ↔ MCP tool references: ${registered.size} registered tools, ${shippedSkillFiles(repoRoot).length} shipped SKILL.md files, ${result.current.length} dangling reference(s) (baseline ${result.current.length - result.unexpected.length + result.fixed.length})`);
  if (result.ok) {
    console.log('  ✓ no NEW dangling references (known ones are listed in verification/skill-mcp-tool-baseline.json)');
  } else {
    console.log('  ✗ NEW dangling reference(s). Use a tool name registered in v3/@claude-flow/cli/src/mcp-tools/*.ts:');
    for (const key of result.unexpected) {
      for (const d of dangling.filter((x) => x.key === key)) console.log(`      '${d.tool}'  ${d.file}:${d.line}`);
    }
  }
  if (result.fixed.length > 0) {
    console.log(`  Progress: ${result.fixed.length} baseline entr${result.fixed.length === 1 ? 'y is' : 'ies are'} fixed. Run: node scripts/audit-skill-mcp-tools.mjs --update-baseline`);
  }
  return result.ok ? 0 : 1;
}

// Compare real paths, as check-guard-tool-names.mjs does: Node canonicalizes the
// module URL, while argv can keep a symlinked path (including macOS /var ->
// /private/var). A string compare would silently skip the audit there.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
