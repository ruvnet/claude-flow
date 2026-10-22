/**
 * ADR-406 P1 — classify the inventory into `CommandDefinition`s, validate
 * them, and emit a deterministic catalog.
 *
 * Determinism: entries sorted by id, object keys sorted recursively, no
 * generation timestamp, and `source.commit` is the last commit that touched
 * the source file (not the generator's HEAD), so regenerating an unchanged
 * tree yields the same bytes.
 */

import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import {
  COMMAND_CATALOG_CONTRACT,
  LIMITS,
  catalogEntrySchema,
  commandCatalogSchema,
  type CatalogEntry,
  type CommandCatalog,
  type CommandDefinition,
  type InventorySource,
} from './schema.js';
import { sha256Hex, type RawCommand } from './inventory.js';

export const REPOSITORY = 'ruvnet/ruflo';
// Loader-exposed documentation is named in capitals (README, CHANGELOG,
// COMMAND_COMPLIANCE_REPORT). Lower-case names such as `performance-report`
// are real workflows and must not be matched by content words.
const DOC_NAME = /^[A-Z][A-Z0-9_]+$/;
const CHANNEL_PRIORITY: Record<InventorySource['channel'], number> = {
  'repo-project-commands': 0,
  'cli-init-template': 1,
  'marketplace-plugin': 2,
  'source-plugin': 3,
  'mod-registration': 4,
};

export interface CatalogOptions {
  /** Repository-relative path -> last commit sha touching it. Missing = `uncommitted`. */
  readonly commits?: Readonly<Record<string, string>>;
  /** True when `packedFiles` was supplied to the inventory, so `shippedIn` is meaningful. */
  readonly packageContentsInspected: boolean;
  /** Last commit touching any command source (stable across unrelated commits). */
  readonly sourceCommit?: string;
}

/** JSON with object keys sorted at every depth and no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

export function catalogDigest(entries: readonly CatalogEntry[]): string {
  return `sha256:${sha256Hex(canonicalJson(entries))}`;
}

function frontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) out[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function substitutionOf(content: string): 'none' | '$ARGUMENTS' | 'positional' {
  if (content.includes('$ARGUMENTS')) return '$ARGUMENTS';
  if (/\$[1-9]\b/.test(content)) return 'positional';
  return 'none';
}

function allowedTools(meta: Record<string, string>): string[] {
  const raw = meta['allowed-tools'];
  if (!raw) return [];
  return [...new Set(raw.replace(/^\[|\]$/g, '').split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean))]
    .map((t) => t.slice(0, LIMITS.capability))
    .slice(0, LIMITS.capabilities)
    .sort();
}

function isDocumentation(source: InventorySource): boolean {
  return DOC_NAME.test(basename(source.sourcePath, '.md'));
}

/** Merge the occurrences of one invocation spelling into one catalog entry. */
export function classify(key: string, occurrences: readonly RawCommand[], options: CatalogOptions): CatalogEntry {
  const ordered = [...occurrences].sort(
    (a, b) => CHANNEL_PRIORITY[a.source.channel] - CHANNEL_PRIORITY[b.source.channel]
      || a.source.sourcePath.localeCompare(b.source.sourcePath),
  );
  const markdown = ordered.filter((o) => o.source.binding === 'markdown-loader');
  const registered = ordered.filter((o) => o.source.binding === 'mod-register');
  const middleware = ordered.filter((o) => o.source.binding === 'mod-middleware-on-markdown');
  const primary = markdown[0] ?? ordered[0];
  const notes: string[] = [];
  const commit = (path: string): string => options.commits?.[path] ?? 'uncommitted';

  let definition: CommandDefinition;
  const base = {
    schemaVersion: 1 as const,
    id: `${primary.ownerPlugin}/${key}`.toLowerCase(),
    revision: 1,
    ownerPlugin: primary.ownerPlugin,
    modelVisibility: 'same-as-legacy' as const,
    source: { repository: REPOSITORY, commit: commit(primary.source.sourcePath), path: primary.source.sourcePath },
  };
  const documentation = markdown.length > 0 && isDocumentation(primary.source);
  if (markdown.length > 0) {
    const content = primary.content ?? '';
    const meta = frontmatter(content);
    const hint = (meta['argument-hint'] ?? '').slice(0, 200);
    definition = {
      ...base,
      legacyNames: [key],
      modNames: [],
      kind: documentation ? 'help' : 'prompt',
      argumentsSchema: hint
        ? { type: 'string', maxLength: 8_192, description: hint }
        : { type: 'string', maxLength: 8_192 },
      prompt: { path: primary.source.sourcePath, sha256: primary.source.digest.slice(7), substitution: substitutionOf(content) },
      requiredCapabilities: allowedTools(meta),
      requiredHostFeatures: [],
      // §7: no engine path to invoke a prompt workflow with its semantics is
      // verified, so the workbench may show or fill it but never run it.
      disposition: documentation ? 'legacy' : 'delegate',
    };
    if (documentation) notes.push('documentation file exposed by the engine command loader; not an executable workflow');
    if (middleware.length > 0) {
      notes.push(`mod middleware attached by ${[...new Set(middleware.map((m) => m.ownerPlugin))].join(', ')} (command.run match)`);
    }
  } else {
    definition = {
      ...base,
      legacyNames: [],
      modNames: [key],
      kind: 'query',
      argumentsSchema: { type: 'string', maxLength: 1_024 },
      requiredCapabilities: [],
      requiredHostFeatures: ['command.register'],
      disposition: 'view',
      viewId: `${primary.ownerPlugin}/${key}`.toLowerCase(),
    };
    notes.push('registered by a function-hook mod; exists only while that mod is loaded');
  }
  if (registered.length > 0 && markdown.length > 0) notes.push('also registered by a mod under the same spelling');

  const markdownDigests = new Set(markdown.map((m) => m.source.digest));
  const divergent = markdownDigests.size > 1;
  if (divergent) notes.push('copies differ between delivery channels; see sources[].digest');

  const shipped = ordered.some((o) =>
    o.source.shippedIn.length > 0
    || o.source.channel === 'marketplace-plugin'
    || (o.source.channel === 'mod-registration' && o.source.package.endsWith('@ruflo')));
  if (!options.packageContentsInspected) notes.push('npm package contents not inspected for this catalog');

  return catalogEntrySchema.parse({
    definition,
    status: documentation ? 'documentation' : shipped ? 'shipped' : 'source-only',
    divergent,
    sources: ordered.map((o) => o.source).slice(0, 8),
    notes: notes.map((n) => n.slice(0, LIMITS.note)),
  });
}

export interface ValidationResult { readonly valid: boolean; readonly errors: readonly string[] }

/** §14 P1 gate: schema-valid definitions, no duplicate ids, no duplicate names. */
export function validateEntries(entries: readonly unknown[]): ValidationResult {
  const errors: string[] = [];
  const ids = new Map<string, number>();
  const names = new Map<string, string>();
  entries.forEach((raw, index) => {
    const parsed = catalogEntrySchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(`entry ${index}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      return;
    }
    const def = parsed.data.definition;
    if (ids.has(def.id)) errors.push(`duplicate id ${def.id} (entries ${ids.get(def.id)} and ${index})`);
    else ids.set(def.id, index);
    for (const name of new Set([...def.legacyNames, ...def.modNames])) {
      const owner = names.get(name.toLowerCase());
      if (owner && owner !== def.id) errors.push(`duplicate name /${name} (${owner} and ${def.id})`);
      else names.set(name.toLowerCase(), def.id);
    }
  });
  return { valid: errors.length === 0, errors };
}

export function buildCatalog(inventory: readonly RawCommand[], options: CatalogOptions): CommandCatalog {
  const groups = new Map<string, RawCommand[]>();
  for (const item of inventory) {
    const list = groups.get(item.key) ?? [];
    list.push(item);
    groups.set(item.key, list);
  }
  const entries = [...groups.entries()]
    .map(([key, list]) => classify(key, list, options))
    .sort((a, b) => (a.definition.id < b.definition.id ? -1 : a.definition.id > b.definition.id ? 1 : 0));
  const validation = validateEntries(entries);
  if (!validation.valid) throw new Error(`command-registry-invalid:\n${validation.errors.join('\n')}`);
  const sourceCommit = options.sourceCommit ?? 'uncommitted';
  return commandCatalogSchema.parse({
    contractVersion: COMMAND_CATALOG_CONTRACT,
    sourceCommit,
    sourceDigest: catalogDigest(entries),
    entries,
  });
}

/** Parse and re-verify a catalog read from disk (the parity check a consumer runs). */
export function verifyCatalog(raw: unknown): ValidationResult {
  const parsed = commandCatalogSchema.safeParse(raw);
  if (!parsed.success) return { valid: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const errors = [...validateEntries(parsed.data.entries).errors];
  if (catalogDigest(parsed.data.entries) !== parsed.data.sourceDigest) errors.push('sourceDigest does not match entries');
  return { valid: errors.length === 0, errors };
}

export function serializeCatalog(catalog: CommandCatalog): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(catalog)), null, 2)}\n`;
}

/**
 * Write the catalog atomically. `expectedSha256` is the digest of the file the
 * caller last read (or `null` for "must not exist"); a mismatch means someone
 * else changed it and the write is refused (§6 concurrent-edit detection).
 */
export function writeCatalog(path: string, catalog: CommandCatalog, expectedSha256?: string | null): { written: boolean; sha256: string } {
  const text = serializeCatalog(catalog);
  const next = sha256Hex(text);
  const current = existsSync(path) ? sha256Hex(readFileSync(path)) : null;
  if (expectedSha256 !== undefined && expectedSha256 !== current) {
    throw new Error(`catalog-changed-on-disk: expected ${expectedSha256 ?? 'absent'}, found ${current ?? 'absent'}`);
  }
  if (current === next) return { written: false, sha256: next };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o644 });
  const fd = openSync(tmp, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  return { written: true, sha256: next };
}
