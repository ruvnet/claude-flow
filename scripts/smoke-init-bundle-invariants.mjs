#!/usr/bin/env node
/**
 * Init-bundle invariants smoke — ADR-128 Phase 5 (#2095).
 *
 * Statically asserts three properties of the @claude-flow/cli init bundle:
 *
 *   1. NO ORPHANED DIRECTORIES — every subdirectory under
 *      v3/@claude-flow/cli/.claude/{commands,agents}/ is reachable from
 *      COMMANDS_MAP or AGENTS_MAP in executor.ts. An "orphaned" directory is
 *      one that ships in the tarball but is never copied by any init path.
 *
 *   2. SKILLS_MAP COMPLETENESS — every skill name in SKILLS_MAP (all arrays)
 *      has a corresponding SKILL.md at
 *      v3/@claude-flow/cli/.claude/skills/{name}/SKILL.md. Catches Phase 1
 *      regressions where a skill dir disappears from the package.
 *
 *   3. NO INIT–PLUGIN AGENT BASENAME COLLISION — no .md file in
 *      v3/@claude-flow/cli/.claude/agents/(any path) shares a basename with any
 *      .md file in plugins/(any plugin)/agents/. Enforces the "plugin is canonical"
 *      dedup rule from ADR-128 Phase 2.
 *
 * Zero runtime dependencies — pure readFileSync + regex + readdirSync.
 * Exit 0: all assertions pass.
 * Exit 1: one or more assertions fail (file + details reported).
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const EXECUTOR_TS = join(REPO_ROOT, 'v3', '@claude-flow', 'cli', 'src', 'init', 'executor.ts');
const CLI_DOT_CLAUDE = join(REPO_ROOT, 'v3', '@claude-flow', 'cli', '.claude');
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listSubdirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

function collectFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    } else if (entry.isDirectory()) {
      results.push(...collectFiles(full, ext));
    }
  }
  return results;
}

// Parse all string values from a Record<string, string[]> literal in source.
// Handles multi-line blocks terminated by the closing '};'.
function parseMapValues(src, mapName) {
  const start = src.indexOf(`const ${mapName}:`);
  if (start === -1) return new Set();
  const block = src.slice(start, src.indexOf('\n};', start) + 3);
  const values = new Set();
  // Match single-quoted string literals
  for (const m of block.matchAll(/'([^']+)'/g)) {
    values.add(m[1]);
  }
  return values;
}

// ---------------------------------------------------------------------------
// Load executor.ts
// ---------------------------------------------------------------------------

if (!existsSync(EXECUTOR_TS)) {
  console.error(`ERROR: executor.ts not found at ${EXECUTOR_TS}`);
  process.exit(1);
}
const executorSrc = readFileSync(EXECUTOR_TS, 'utf-8');

// ---------------------------------------------------------------------------
// Assertion 1: No orphaned command or agent subdirectories
// ---------------------------------------------------------------------------

const commandsValues = parseMapValues(executorSrc, 'COMMANDS_MAP');
const agentsValues = parseMapValues(executorSrc, 'AGENTS_MAP');

const commandsDirs = listSubdirs(join(CLI_DOT_CLAUDE, 'commands'));
const agentsDirs = listSubdirs(join(CLI_DOT_CLAUDE, 'agents'));

const orphanViolations = [];

for (const dir of commandsDirs) {
  if (!commandsValues.has(dir)) {
    orphanViolations.push({
      type: 'orphan-command-dir',
      path: `v3/@claude-flow/cli/.claude/commands/${dir}`,
      message: `commands/${dir}/ has no COMMANDS_MAP entry`,
    });
  }
}

for (const dir of agentsDirs) {
  if (!agentsValues.has(dir)) {
    orphanViolations.push({
      type: 'orphan-agent-dir',
      path: `v3/@claude-flow/cli/.claude/agents/${dir}`,
      message: `agents/${dir}/ has no AGENTS_MAP entry`,
    });
  }
}

// ---------------------------------------------------------------------------
// Assertion 2: Every SKILLS_MAP skill has a SKILL.md in the package
// ---------------------------------------------------------------------------

const skillsMapValues = parseMapValues(executorSrc, 'SKILLS_MAP');
const skillsDir = join(CLI_DOT_CLAUDE, 'skills');
const missingSkills = [];

for (const skillName of skillsMapValues) {
  const skillDir = join(skillsDir, skillName);
  const skillMd = join(skillDir, 'SKILL.md');
  const readmeMd = join(skillDir, 'README.md');
  // Skill must have a directory with at least SKILL.md or README.md
  if (!existsSync(skillMd) && !existsSync(readmeMd)) {
    missingSkills.push({
      type: 'missing-skill',
      // Report the SKILL.md path for clarity even though README.md is accepted
      path: `v3/@claude-flow/cli/.claude/skills/${skillName}/SKILL.md`,
      message: `SKILLS_MAP references '${skillName}' but neither SKILL.md nor README.md found in package`,
    });
  }
}

// ---------------------------------------------------------------------------
// Assertion 3: No init-template agent basename collides with a plugin agent
// ---------------------------------------------------------------------------

const initAgentFiles = collectFiles(join(CLI_DOT_CLAUDE, 'agents'), '.md');
const initBasenames = new Set(initAgentFiles.map(f => f.split('/').pop()));

const pluginAgentFiles = existsSync(PLUGINS_DIR)
  ? readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .flatMap(e => collectFiles(join(PLUGINS_DIR, e.name, 'agents'), '.md'))
  : [];

const collisionViolations = [];

for (const pluginFile of pluginAgentFiles) {
  const basename = pluginFile.split('/').pop();
  if (initBasenames.has(basename)) {
    // Find the init copy for the error message
    const initCopy = initAgentFiles.find(f => f.split('/').pop() === basename);
    collisionViolations.push({
      type: 'agent-collision',
      init: initCopy.replace(REPO_ROOT + '/', ''),
      plugin: pluginFile.replace(REPO_ROOT + '/', ''),
      message: `'${basename}' exists in both init template and plugin (plugin must be canonical)`,
    });
  }
}

// ---------------------------------------------------------------------------
// Report results
// ---------------------------------------------------------------------------

const allViolations = [...orphanViolations, ...missingSkills, ...collisionViolations];

if (allViolations.length === 0) {
  console.log('ok: init-bundle invariants pass (no orphans, all skills present, no plugin-init overlap)');
  console.log(`  commands dirs checked: ${commandsDirs.length}`);
  console.log(`  agents dirs checked: ${agentsDirs.length}`);
  console.log(`  skills checked: ${skillsMapValues.size}`);
  console.log(`  plugin agent basenames checked: ${pluginAgentFiles.length}`);
  process.exit(0);
}

console.error(`\n${allViolations.length} init-bundle invariant violation(s):\n`);

for (const v of allViolations) {
  if (v.type === 'orphan-command-dir' || v.type === 'orphan-agent-dir') {
    console.error(`  [ORPHAN] ${v.path}`);
    console.error(`    ${v.message}`);
    console.error(`    Fix: add a COMMANDS_MAP or AGENTS_MAP entry for this directory,`);
    console.error(`         or delete the directory if it belongs to a plugin.`);
  } else if (v.type === 'missing-skill') {
    console.error(`  [MISSING-SKILL] ${v.path}`);
    console.error(`    ${v.message}`);
    console.error(`    Fix: copy the skill from .claude/skills/${v.path.split('/').at(-2)}/ into the package.`);
  } else if (v.type === 'agent-collision') {
    console.error(`  [COLLISION] ${v.message}`);
    console.error(`    init:   ${v.init}`);
    console.error(`    plugin: ${v.plugin}`);
    console.error(`    Fix: delete the init-template copy; the plugin version is canonical (ADR-128 §Phase 2).`);
  }
}

console.error('\nADR-128: https://github.com/ruvnet/ruflo/blob/main/v3/docs/adr/ADR-128-init-bundle-reduce-refactor.md\n');
process.exit(1);
