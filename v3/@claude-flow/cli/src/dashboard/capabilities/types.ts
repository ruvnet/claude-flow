/** Shared shapes of the capability channel (docs/parity-capability-design.md). */
import type { CapabilityRisk } from '../protocol/index.js';

export type CapLevel = 'read' | 'write' | 'manage';
export type CapKind = 'command' | 'skill' | 'tool' | 'view';
export type ArgType = 'string' | 'int' | 'bool' | 'enum' | 'path';
/** One typed argument slot. A string slot MUST carry a pattern: there is no free text. */
export interface ArgSpec { name: string; type: ArgType; required?: boolean; max?: number; min?: number; enum?: readonly string[]; pattern?: RegExp }
export type ArgValues = Record<string, string | number | boolean>;

/** What a binding runs. Nothing here is read from a manifest. */
export type Action =
  | { kind: 'mcp'; tool: string; params: (a: ArgValues) => Record<string, unknown> }
  | { kind: 'cli'; argv: (a: ArgValues) => string[] }
  | { kind: 'script'; file: string; sha256: Record<string, string>; argv: (a: ArgValues) => string[] };

export interface Binding {
  plugin: string; kind: CapKind; name: string;
  /** File inside the plugin that pins the capability id (the skill/command markdown). For a view, any file the plugin ships that documents it. */
  pinFile: string;
  level: CapLevel; risk: CapabilityRisk; timeoutMs?: number;
  args: readonly ArgSpec[];
  action: Action;
  /** Tools that spawn plugin scripts through ruflo itself (the metaharness family): refused when the project could shadow them. */
  metaharness?: boolean;
}

export type { RefuseCode } from '../protocol/index.js';
import type { RefuseCode } from '../protocol/index.js';

export interface CatalogCap {
  cid: string; kind: CapKind; name: string; risk: CapabilityRisk; level: CapLevel | null; mode: 'run' | 'view' | 'refused'; why?: RefuseCode;
  args?: Array<{ name: string; type: ArgType; max?: number; min?: number; enum?: string[] }>;
  /** Not sent: the binding that makes it runnable, and the file hash it was pinned on. */
  binding?: Binding; fileSha12: string;
}
export interface CatalogOption { key: string; type: string; default?: boolean | number | string; choices?: string[]; settable: boolean; why?: RefuseCode; rule?: 'bool' | 'enum' | 'toward' | 'range' | 'cap'; toward?: import('./options.js').AnyRule; cap?: boolean; min?: number; max?: number }
export interface CatalogPlugin {
  id: string; name: string; marketplace: string; version: string; manifestSha: string; enabled: boolean; mod: boolean; foreign: boolean; why?: RefuseCode;
  counts: { commands: number; skills: number; agents: number; options: number; mcp: number };
  caps: CatalogCap[]; options: CatalogOption[];
  /** Absolute install dir, never sent. */
  dir: string;
}
export interface Catalog { plugins: CatalogPlugin[]; treeSha: string }
