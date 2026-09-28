/**
 * Typed loader for the team bus store (ADR-402).
 *
 * The store is templates/grok/scripts/grok-team-bus.mjs (operations) and
 * grok-team-store.mjs (storage) — the same files `init --grok` copies into a
 * project — so the MCP tools, the `ruflo team` runner and the SubagentStop
 * hook share one implementation. Everything here is synchronous and throws
 * Error on failure.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { grokTemplatesRoot } from '../init/grok-templates.js';
import type { RoleTable } from './team-hosts/plan.js';

type Obj = Record<string, unknown>;
export type BusOp = (projectRoot: string, opts: Obj) => Obj;

export interface BusMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  summary?: string;
  content: string;
  priority?: number;
  timestamp?: string;
}

export interface TeamBus {
  createTeam: BusOp;
  spawnMember: BusOp;
  sendMessage: BusOp;
  readInbox: (projectRoot: string, opts: { team: string; agent: string; peek?: boolean }) => { messages: BusMessage[] } & Obj;
  teamStatus: BusOp;
  setPlan: BusOp;
  onStop: BusOp;
  shutdownTeam: BusOp;
  teamsWithMember: (projectRoot: string, agent: string) => string[];
  ROLE_DEFAULTS: RoleTable;
}

export interface StoreMember {
  name: string;
  role: string;
  status: string;
  next?: string[];
  spawn?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StoreTeam {
  id: string;
  name: string;
  status: string;
  host?: string;
  shutdownAt?: string;
  members: Record<string, StoreMember>;
  plan: { steps: Array<{ id: string; agent: string; status: string }>; index: number };
  [key: string]: unknown;
}

export interface TeamStore {
  loadTeam: (projectRoot: string, team: string) => StoreTeam;
  updateTeam: <T>(projectRoot: string, team: string, mutate: (t: StoreTeam) => T) => T;
  assertActive: (t: StoreTeam) => void;
  teamDir: (projectRoot: string, team: string) => string;
  ensureRealDir: (base: string, dir: string) => void;
}

let busPromise: Promise<TeamBus> | null = null;
let storePromise: Promise<TeamStore> | null = null;

function load<T>(file: string): Promise<T> {
  return import(pathToFileURL(join(grokTemplatesRoot(), 'scripts', file)).href) as Promise<T>;
}

export function loadBus(): Promise<TeamBus> {
  if (!busPromise) {
    busPromise = load<TeamBus>('grok-team-bus.mjs');
    busPromise.catch(() => { busPromise = null; });
  }
  return busPromise;
}

export function loadStore(): Promise<TeamStore> {
  if (!storePromise) {
    storePromise = load<TeamStore>('grok-team-store.mjs');
    storePromise.catch(() => { storePromise = null; });
  }
  return storePromise;
}
