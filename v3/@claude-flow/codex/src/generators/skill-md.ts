/**
 * @claude-flow/codex - SKILL.md Generator
 *
 * Custom skills are rendered from typed options. Built-in skills use the
 * packaged `.agents/skills` trees as their canonical definitions so direct
 * generation, project initialization, and npm artifacts cannot drift.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuiltInSkill, SkillMdOptions, SkillCommand } from '../types.js';

export const BUILT_IN_SKILL_NAMES: readonly BuiltInSkill[] = [
  'swarm-orchestration',
  'memory-management',
  'sparc-methodology',
  'security-audit',
  'performance-analysis',
  'github-automation',
];

const BUILT_IN_SKILLS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.agents/skills',
);

/**
 * Generate a SKILL.md file based on the provided options.
 */
export async function generateSkillMd(options: SkillMdOptions): Promise<string> {
  const {
    name,
    description,
    version = '1.0.0',
    author = 'rUv',
    tags,
    triggers = [],
    skipWhen = [],
    scripts = [],
    references = [],
    commands = [],
  } = options;

  const tagList = tags && tags.length > 0 ? tags : name.split('-').filter(Boolean);
  const triggerText = triggers.length > 0
    ? `Use when: ${triggers.join(', ')}.`
    : '';
  const skipText = skipWhen.length > 0
    ? `Skip when: ${skipWhen.join(', ')}.`
    : '';

  const frontmatter = `---
name: ${name}
version: "${version}"
author: ${author}
tags: [${tagList.join(', ')}]
description: >
  ${description}
  ${triggerText}
  ${skipText}
---`;

  const commandsSection = commands.length > 0 ? buildCommandsSection(commands) : '';
  const scriptsSection = scripts.length > 0 ? buildScriptsSection(scripts) : '';
  const referencesSection = references.length > 0 ? buildReferencesSection(references) : '';

  return `${frontmatter}

# ${formatSkillName(name)} Skill

## Purpose
${description}

## When to Trigger
${triggers.length > 0 ? triggers.map(t => `- ${t}`).join('\n') : '- Define triggers for this skill'}

## When to Skip
${skipWhen.length > 0 ? skipWhen.map(s => `- ${s}`).join('\n') : '- Define skip conditions for this skill'}
${commandsSection}
${scriptsSection}
${referencesSection}
## Best Practices
1. Check memory for existing patterns before starting
2. Use hierarchical topology for coordination
3. Store successful patterns after completion
4. Document any new learnings
`;
}

function buildCommandsSection(commands: SkillCommand[]): string {
  const lines = commands.map(cmd => {
    let block = `### ${cmd.name}\n${cmd.description}\n\n\`\`\`bash\n${cmd.command}\n\`\`\``;
    if (cmd.example) {
      block += `\n\n**Example:**\n\`\`\`bash\n${cmd.example}\n\`\`\``;
    }
    return block;
  });

  return `
## Commands

${lines.join('\n\n')}
`;
}

function buildScriptsSection(scripts: { name: string; path: string; description: string }[]): string {
  const lines = scripts.map(s => `| \`${s.name}\` | \`${s.path}\` | ${s.description} |`);

  return `
## Scripts

| Script | Path | Description |
|--------|------|-------------|
${lines.join('\n')}
`;
}

function buildReferencesSection(references: { name: string; path: string; description?: string }[]): string {
  const lines = references.map(r =>
    `| \`${r.name}\` | \`${r.path}\` | ${r.description ?? ''} |`
  );

  return `
## References

| Document | Path | Description |
|----------|------|-------------|
${lines.join('\n')}
`;
}

function formatSkillName(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function readPayloadTree(root: string): Promise<Record<string, string>> {
  const payload: Record<string, string> = {};

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Built-in skill payload cannot contain symlinks: ${absolute}`);
      }
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        const relative = path.relative(root, absolute);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error(`Built-in skill payload escapes its root: ${absolute}`);
        }
        const payloadPath = relative.split(path.sep).join('/');
        payload[payloadPath] = await readFile(absolute, 'utf8');
      }
    }
  }

  await visit(root);
  return payload;
}

/**
 * Read one canonical built-in tree from the package payload.
 */
export async function generateBuiltInSkill(
  skillName: string,
): Promise<{ skillMd: string; scripts: Record<string, string>; references: Record<string, string> }> {
  if (!BUILT_IN_SKILL_NAMES.includes(skillName as BuiltInSkill)) {
    throw new Error(`Unknown built-in skill: ${skillName}`);
  }

  const skillRoot = path.join(BUILT_IN_SKILLS_ROOT, skillName);
  let skillMd: string;
  try {
    skillMd = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Built-in skill payload missing: ${skillName}/SKILL.md`);
    }
    throw error;
  }

  const result = {
    skillMd,
    scripts: await readPayloadTree(path.join(skillRoot, 'scripts')),
    references: await readPayloadTree(path.join(skillRoot, 'references')),
  };
  validateBuiltInSkillPayload(skillName, result.skillMd, result.scripts, result.references);
  return result;
}

/**
 * Ensure every skill-local path is contained in and shipped with its tree.
 */
export function validateBuiltInSkillPayload(
  skillName: string,
  skillMd: string,
  scripts: Record<string, string>,
  references: Record<string, string>,
): void {
  const localPaths = Array.from(
    skillMd.matchAll(/`((?:scripts|references)\/[^`\s]+)`/g),
    (match) => match[1]!,
  );

  for (const localPath of localPaths) {
    const normalized = path.posix.normalize(localPath.replaceAll('\\', '/'));
    if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
      throw new Error(`Built-in skill path escapes ${skillName}: ${localPath}`);
    }
    const slash = normalized.indexOf('/');
    const directory = normalized.slice(0, slash);
    const payloadPath = normalized.slice(slash + 1);
    const payload = directory === 'scripts' ? scripts : references;
    if (!Object.hasOwn(payload, payloadPath)) {
      throw new Error(`Built-in skill payload missing: ${skillName}/${normalized}`);
    }
  }
}
