/**
 * ADR-406 P0/P1 — inventory, strict registry schema, validator, deterministic
 * catalog, and the "legacy files unchanged" exit gate.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CATALOG_RELATIVE_PATH,
  INIT_COMMAND_CATEGORIES,
  anchorCommit,
  buildCatalog,
  catalogDigest,
  collectInventory,
  commandDefinitionSchema,
  generate,
  parseValidateOutput,
  scanModHooksFromSource,
  serializeCatalog,
  validateEntries,
  verifyCatalog,
  writeCatalog,
  type CommandDefinition,
} from '../../src/mods/command-registry/index.js';

const REPO_ROOT = resolve(__dirname, '../../../../..');

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ruflo-cmd-registry-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function put(rel: string, text: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function fixtureRepo(): void {
  put('.claude/commands/sparc/architect.md', '---\nallowed-tools: Read, Bash\nargument-hint: <task>\n---\nDesign $ARGUMENTS\n');
  put('.claude/commands/agents/README.md', '# Agents\n');
  put('.claude/commands/analysis/COMMAND_COMPLIANCE_REPORT.md', '# Report\n');
  put('.claude/commands/analysis/performance-report.md', 'Report on $ARGUMENTS\n');
  put('.claude/commands/claude-flow-help.md', 'help\n');
  put('v3/@claude-flow/cli/.claude/commands/sparc/architect.md', '---\nallowed-tools: Read, Bash\n---\nDesign it differently $ARGUMENTS\n');
  put('v3/@claude-flow/cli/.claude/commands/claude-flow-help.md', 'help\n');
  put('.claude-plugin/marketplace.json', JSON.stringify({ plugins: [{ name: 'ruflo-swarm', source: './plugins/ruflo-swarm' }] }));
  put('plugins/ruflo-swarm/commands/watch.md', 'Watch $1\n');
  put('plugins/ruflo-swarm/hooks/register.ts', "on('command.run', { command: 'ruflo-swarm:watch' }, f)\n");
  put('plugins/ruflo-swarm/hooks/commands.ts', "const C = [{ name: 'ruflo-swarm-status', description: 'x' }]\n");
  put('plugins/ruflo-orphan/commands/lonely.md', 'lonely\n');
}

const baseDefinition = (): CommandDefinition => ({
  schemaVersion: 1,
  id: 'project/sparc:architect',
  revision: 1,
  ownerPlugin: 'project',
  legacyNames: ['sparc:architect'],
  modNames: [],
  kind: 'prompt',
  argumentsSchema: { type: 'string' },
  prompt: { path: '.claude/commands/sparc/architect.md', sha256: 'a'.repeat(64), substitution: '$ARGUMENTS' },
  requiredCapabilities: [],
  requiredHostFeatures: [],
  disposition: 'delegate',
  modelVisibility: 'same-as-legacy',
  source: { repository: 'ruvnet/ruflo', commit: 'uncommitted', path: '.claude/commands/sparc/architect.md' },
});

describe('CommandDefinition schema (ADR-406 §6)', () => {
  it('accepts the exact contract', () => {
    expect(commandDefinitionSchema.safeParse(baseDefinition()).success).toBe(true);
  });
  it('rejects unknown fields at every level', () => {
    expect(commandDefinitionSchema.safeParse({ ...baseDefinition(), shell: 'rm -rf /' }).success).toBe(false);
    const def = baseDefinition();
    expect(commandDefinitionSchema.safeParse({ ...def, source: { ...def.source, exec: '/bin/sh' } }).success).toBe(false);
  });
  it('refuses dispatch for prompt workflows and dispatch without a binding (§7)', () => {
    expect(commandDefinitionSchema.safeParse({ ...baseDefinition(), disposition: 'dispatch' }).success).toBe(false);
    expect(commandDefinitionSchema.safeParse({
      ...baseDefinition(), kind: 'query', prompt: undefined, disposition: 'dispatch',
    }).success).toBe(false);
  });
  it('caps argumentsSchema size and rejects shell-ish names and traversal paths', () => {
    expect(commandDefinitionSchema.safeParse({ ...baseDefinition(), argumentsSchema: { d: 'x'.repeat(5000) } }).success).toBe(false);
    expect(commandDefinitionSchema.safeParse({ ...baseDefinition(), legacyNames: ['a; rm'] }).success).toBe(false);
    const def = baseDefinition();
    expect(commandDefinitionSchema.safeParse({ ...def, prompt: { ...def.prompt!, path: '../etc/passwd' } }).success).toBe(false);
  });
});

describe('inventory and catalog over a fixture repository', () => {
  it('records channel, digest, invocation and binding; merges copies; labels docs and source-only', () => {
    fixtureRepo();
    const inventory = collectInventory({ repoRoot: root, modHooks: scanModHooksFromSource(root) });
    const catalog = buildCatalog(inventory, { packageContentsInspected: false });
    const byId = new Map(catalog.entries.map((e) => [e.definition.id, e]));

    const architect = byId.get('project/sparc:architect')!;
    expect(architect.sources.map((s) => s.channel)).toEqual(['repo-project-commands', 'cli-init-template']);
    expect(architect.divergent).toBe(true);
    expect(architect.definition.disposition).toBe('delegate');
    expect(architect.definition.requiredCapabilities).toEqual(['Bash', 'Read']);
    expect(architect.sources[1].initCategory).toBe('sparc');
    expect(architect.sources[0].observedInvocation).toBe('/sparc:architect');

    const readme = byId.get('project/agents:readme')!;
    expect(readme.status).toBe('documentation');
    expect(readme.definition.kind).toBe('help');
    expect(byId.get('project/analysis:command_compliance_report')!.status).toBe('documentation');
    // A lower-case workflow whose name contains "report" is a workflow, not docs.
    expect(byId.get('project/analysis:performance-report')!.definition).toMatchObject({ kind: 'prompt', disposition: 'delegate' });

    const watch = byId.get('ruflo-swarm/ruflo-swarm:watch')!;
    expect(watch.sources.map((s) => s.binding)).toEqual(['markdown-loader', 'mod-middleware-on-markdown']);
    expect(watch.definition.prompt?.substitution).toBe('positional');

    const status = byId.get('ruflo-swarm/ruflo-swarm-status')!;
    expect(status.definition).toMatchObject({ kind: 'query', disposition: 'view', modNames: ['ruflo-swarm-status'] });

    expect(byId.get('ruflo-orphan/ruflo-orphan:lonely')!.status).toBe('source-only');
    expect(byId.get('ruflo-swarm/ruflo-swarm:watch')!.status).toBe('shipped');
  });

  it('is deterministic: same bytes on regeneration and independent of input order', () => {
    fixtureRepo();
    const inventory = collectInventory({ repoRoot: root, modHooks: scanModHooksFromSource(root) });
    const a = serializeCatalog(buildCatalog(inventory, { packageContentsInspected: false }));
    const b = serializeCatalog(buildCatalog([...inventory].reverse(), { packageContentsInspected: false }));
    expect(a).toBe(b);
    expect(a).not.toMatch(/generatedAt|timestamp/);
  });

  it('verifyCatalog detects tampering', () => {
    fixtureRepo();
    const catalog = buildCatalog(collectInventory({ repoRoot: root }), { packageContentsInspected: false });
    expect(verifyCatalog(catalog).valid).toBe(true);
    const tampered = JSON.parse(JSON.stringify(catalog));
    tampered.entries[0].definition.revision = 2;
    expect(verifyCatalog(tampered).valid).toBe(false);
    expect(catalogDigest(catalog.entries)).toBe(catalog.sourceDigest);
  });

  it('writeCatalog refuses when the file changed since it was read', () => {
    fixtureRepo();
    const catalog = buildCatalog(collectInventory({ repoRoot: root }), { packageContentsInspected: false });
    const path = join(root, 'out.json');
    writeCatalog(path, catalog, null);
    writeFileSync(path, '{"edited":true}');
    expect(() => writeCatalog(path, catalog, 'f'.repeat(64))).toThrow(/catalog-changed-on-disk/);
  });
});

describe('validator (P1 gate)', () => {
  it('rejects duplicate ids and duplicate names across entries', () => {
    const entry = (id: string, name: string) => ({
      definition: { ...baseDefinition(), id, legacyNames: [name] },
      status: 'shipped', divergent: false, notes: [],
      sources: [{ channel: 'repo-project-commands', package: 'claude-flow', sourcePath: 'x.md', digest: `sha256:${'b'.repeat(64)}`, observedInvocation: `/${name}`, binding: 'markdown-loader', shippedIn: [] }],
    });
    expect(validateEntries([entry('a', 'one'), entry('a', 'two')]).errors.join()).toMatch(/duplicate id a/);
    expect(validateEntries([entry('a', 'one'), entry('b', 'ONE')]).errors.join()).toMatch(/duplicate name \/ONE/);
    expect(validateEntries([entry('a', 'one'), entry('b', 'two')]).valid).toBe(true);
  });
});

describe('catalog anchor commit', () => {
  it('is the newest commit touching an inventoried path, not any commit under the roots', () => {
    const commits = { byPath: { 'a.md': 'c2', 'b.md': 'c3' }, order: ['c1', 'c2', 'c3'], dirty: new Set<string>() };
    expect(anchorCommit(['a.md', 'b.md'], commits)).toBe('c2');
    expect(anchorCommit(['a.md', 'x.md'], commits)).toBe('uncommitted');
    expect(anchorCommit(['a.md'], { ...commits, dirty: new Set(['a.md']) })).toBe('uncommitted');
  });
});

describe('engine validate parsing', () => {
  it('collects command hooks and host calls from per-file lines, not the "Validating hooks" header', () => {
    const text = [
      'Validating hooks: /x/hooks/hooks.json',
      '  ❯ ./register.ts hooks: session.start, command.run{command=ruflo-mods}, tool.call',
      '  ❯ ./register.ts calls: $.command.register, $.prompt.fill (via host), $.fs.read',
      '✔ Validation passed',
    ].join('\n');
    const v = parseValidateOutput('ruflo-mods', 0, text);
    expect(v).toMatchObject({ passed: true, commandHooks: ['ruflo-mods'], hostCalls: ['command.register', 'fs.read', 'prompt.fill'] });
    expect(parseValidateOutput('x', 1, 'error').passed).toBe(false);
  });

  it('splits an alternation matcher into its names and drops a dynamic (?) matcher', () => {
    const text = '  ❯ ./register.ts hooks: command.run{command=?}, command.run{command=ruflo|ruflo-console}, command.run{command=ruflo-swarm:watch}';
    const v = parseValidateOutput('ruflo-swarm', 0, text);
    expect(v.commandHooks).toEqual(['ruflo', 'ruflo-console', 'ruflo-swarm:watch']);
    expect(v.dynamicCommandHook).toBe(true);
    expect(parseValidateOutput('x', 0, '  ❯ ./a.ts hooks: command.run{command=x}').dynamicCommandHook).toBeUndefined();
  });
});

describe('repository gates', () => {
  it('INIT_COMMAND_CATEGORIES mirrors COMMANDS_MAP in init/executor.ts', () => {
    const source = readFileSync(resolve(__dirname, '../../src/init/executor.ts'), 'utf8');
    const block = source.slice(source.indexOf('const COMMANDS_MAP'), source.indexOf('};', source.indexOf('const COMMANDS_MAP')));
    for (const [key, values] of Object.entries(INIT_COMMAND_CATEGORIES)) {
      expect(block).toMatch(new RegExp(`\\b${key}: \\[${values.map((v) => `'${v.replace('.', '\\.')}'`).join(', ')}\\]`));
    }
    expect((block.match(/^\s+\w+: \[/gm) ?? []).length).toBe(Object.keys(INIT_COMMAND_CATEGORIES).length);
  });

  it('generation leaves every legacy command file byte-unchanged', () => {
    const dirs = ['.claude/commands', 'v3/@claude-flow/cli/.claude/commands', 'plugins'];
    const snapshot = (): Map<string, string> => {
      const out = new Map<string, string>();
      const walk = (d: string): void => {
        if (!existsSync(d)) return;
        for (const n of readdirSync(d)) {
          const f = join(d, n);
          if (n === 'node_modules') continue;
          if (statSync(f).isDirectory()) walk(f);
          else if (f.includes('/commands/') && n.endsWith('.md')) out.set(f, createHash('sha256').update(readFileSync(f)).digest('hex'));
        }
      };
      for (const d of dirs) walk(join(REPO_ROOT, d));
      return out;
    };
    const before = snapshot();
    expect(before.size).toBeGreaterThan(300);
    generate({ repoRoot: REPO_ROOT, engineExecutable: null, inspectPackages: false });
    expect(snapshot()).toEqual(before);
  }, 60_000);

  it('the committed catalog verifies (schema, unique ids and names, digest)', () => {
    const file = join(REPO_ROOT, CATALOG_RELATIVE_PATH);
    const result = verifyCatalog(JSON.parse(readFileSync(file, 'utf8')));
    expect(result.errors).toEqual([]);
  });
});
