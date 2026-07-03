/**
 * trajectory-tree.ts — Execution-state-tree retrieval PROTOTYPE (MAGE-style).
 *
 * Research basis: MAGE (arXiv 2606.06090) observes that semantic-similarity
 * retrieval fragments decision trajectories on long-horizon tasks; retrieving
 * by POSITION in a hierarchical execution-state tree (the root→current path)
 * preserves coherence. This module mirrors ruflo's existing trajectory
 * recording (hooks_intelligence_trajectory-start/step/end) into such a tree
 * and offers position-based recall — NO embedding search anywhere.
 *
 * Structure:
 *   session root ─ trajectory ─ step
 *                       └ trajectory (nested: a start while another is open
 *                                     opens UNDER the open one) ─ step …
 *
 * - `trajectory-start` opens a node under the deepest open trajectory of the
 *   session (or the session root).
 * - `trajectory-step` appends a step child; the step becomes the "current"
 *   position of the session.
 * - `trajectory-end` closes the node; current returns to its parent.
 * - `recallPath({sessionId, depth})` returns the root→current path (the
 *   MAGE-style working context) plus the most recent siblings of the current
 *   node.
 *
 * PROTOTYPE LIMITATIONS (deliberate — see the feature spec):
 * - Persistence is a single best-effort JSON snapshot at
 *   `.claude-flow/intelligence/trajectory-tree.json`, written on every
 *   mutation. It sits ALONGSIDE the existing 'trajectories' memory-namespace
 *   persistence; nothing is migrated and the semantic path is untouched.
 * - No concurrency control: two MCP server processes sharing a cwd will
 *   last-writer-win the snapshot.
 * - No pruning/compaction: long-lived sessions grow the file unboundedly
 *   (labels are truncated to 200 chars to bound row size, not row count).
 * - sessionId defaults to CLAUDE_FLOW_SESSION_ID or 'default'; hosts that
 *   never set it collapse into one tree.
 * - Retrieval is position-only by design; hybrid position+semantic ranking
 *   is future work.
 *
 * @module ruvector/trajectory-tree
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type TreeNodeKind = 'session' | 'trajectory' | 'step';

export interface TreeNode {
  id: string;
  kind: TreeNodeKind;
  /** Task text (trajectory), action text (step), or session id — ≤200 chars. */
  label: string;
  parentId: string | null;
  childIds: string[];
  status: 'open' | 'closed';
  openedAt: string;
  closedAt?: string;
  meta?: Record<string, unknown>;
}

export interface RecallResult {
  sessionId: string;
  /** Root→current node path (the MAGE-style working context). */
  path: TreeNode[];
  /** Most recent siblings of the current node (excluding it), oldest→newest. */
  siblings: TreeNode[];
  /** Id of the current node (deepest position in the session). */
  currentId: string | null;
  strategy: 'state-tree';
}

interface TreeSnapshot {
  v: 1;
  nodes: Record<string, TreeNode>;
  currentBySession: Record<string, string>;
  trajectorySession: Record<string, string>;
}

const DEFAULT_PERSIST_PATH = join('.claude-flow', 'intelligence', 'trajectory-tree.json');
const LABEL_MAX = 200;

function now(): string {
  return new Date().toISOString();
}

function truncate(text: string): string {
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;
}

export class TrajectoryTree {
  private nodes = new Map<string, TreeNode>();
  /** sessionId → id of the deepest "current" node (step or open trajectory). */
  private currentBySession = new Map<string, string>();
  /** trajectoryId → sessionId, so step/end calls can omit the session. */
  private trajectorySession = new Map<string, string>();
  private readonly persistPath: string;

  constructor(persistPath?: string) {
    this.persistPath = resolve(persistPath ?? DEFAULT_PERSIST_PATH);
    this.load();
  }

  private sessionRootId(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private ensureSession(sessionId: string): TreeNode {
    const id = this.sessionRootId(sessionId);
    let node = this.nodes.get(id);
    if (!node) {
      node = {
        id,
        kind: 'session',
        label: truncate(sessionId),
        parentId: null,
        childIds: [],
        status: 'open',
        openedAt: now(),
      };
      this.nodes.set(id, node);
    }
    return node;
  }

  /** Deepest OPEN trajectory node on the current path of a session, if any. */
  private deepestOpenTrajectory(sessionId: string): TreeNode | null {
    let cursor = this.nodes.get(this.currentBySession.get(sessionId) ?? '');
    while (cursor) {
      if (cursor.kind === 'trajectory' && cursor.status === 'open') return cursor;
      cursor = cursor.parentId ? this.nodes.get(cursor.parentId) : undefined;
    }
    return null;
  }

  openTrajectory(args: { sessionId: string; trajectoryId: string; task: string; agent?: string }): TreeNode {
    const session = this.ensureSession(args.sessionId);
    const parent = this.deepestOpenTrajectory(args.sessionId) ?? session;
    const node: TreeNode = {
      id: args.trajectoryId,
      kind: 'trajectory',
      label: truncate(args.task),
      parentId: parent.id,
      childIds: [],
      status: 'open',
      openedAt: now(),
      meta: args.agent ? { agent: args.agent } : undefined,
    };
    this.nodes.set(node.id, node);
    parent.childIds.push(node.id);
    this.trajectorySession.set(args.trajectoryId, args.sessionId);
    this.currentBySession.set(args.sessionId, node.id);
    this.save();
    return node;
  }

  appendStep(args: { trajectoryId: string; stepId: string; action: string; quality?: number }): TreeNode | null {
    const trajectory = this.nodes.get(args.trajectoryId);
    if (!trajectory || trajectory.kind !== 'trajectory') return null;
    const sessionId = this.trajectorySession.get(args.trajectoryId);
    // The upstream stepId scheme (`step-${Date.now()}`) can collide within a
    // millisecond — uniquify locally instead of clobbering an existing node.
    let stepId = args.stepId;
    let bump = 1;
    while (this.nodes.has(stepId)) stepId = `${args.stepId}-${bump++}`;
    const node: TreeNode = {
      id: stepId,
      kind: 'step',
      label: truncate(args.action),
      parentId: trajectory.id,
      childIds: [],
      status: 'closed',
      openedAt: now(),
      closedAt: now(),
      meta: args.quality !== undefined ? { quality: args.quality } : undefined,
    };
    this.nodes.set(node.id, node);
    trajectory.childIds.push(node.id);
    if (sessionId) this.currentBySession.set(sessionId, node.id);
    this.save();
    return node;
  }

  closeTrajectory(args: { trajectoryId: string; success?: boolean }): TreeNode | null {
    const trajectory = this.nodes.get(args.trajectoryId);
    if (!trajectory || trajectory.kind !== 'trajectory') return null;
    trajectory.status = 'closed';
    trajectory.closedAt = now();
    if (args.success !== undefined) {
      trajectory.meta = { ...trajectory.meta, success: args.success };
    }
    const sessionId = this.trajectorySession.get(args.trajectoryId);
    if (sessionId && trajectory.parentId) {
      // Current position pops back to the enclosing trajectory / session root.
      this.currentBySession.set(sessionId, trajectory.parentId);
    }
    this.save();
    return trajectory;
  }

  /**
   * MAGE-style positional recall: the exact root→current path for a session,
   * plus the most recent siblings of the current node for local context.
   *
   * @param depth Max number of path nodes returned, counted from the CURRENT
   *              node upward (deepest levels win). Default: full path.
   * @param siblingWindow Max recent siblings of the current node. Default 3.
   */
  recallPath(args: { sessionId: string; depth?: number; siblingWindow?: number }): RecallResult {
    const currentId = this.currentBySession.get(args.sessionId) ?? null;
    const path: TreeNode[] = [];
    let cursor = currentId ? this.nodes.get(currentId) : undefined;
    while (cursor) {
      path.unshift(cursor);
      cursor = cursor.parentId ? this.nodes.get(cursor.parentId) : undefined;
    }
    const depth = args.depth && args.depth > 0 ? args.depth : path.length;
    const trimmedPath = path.slice(Math.max(0, path.length - depth));

    const siblingWindow = args.siblingWindow ?? 3;
    let siblings: TreeNode[] = [];
    const current = currentId ? this.nodes.get(currentId) : undefined;
    const parent = current?.parentId ? this.nodes.get(current.parentId) : undefined;
    if (current && parent) {
      siblings = parent.childIds
        .filter(id => id !== current.id)
        .map(id => this.nodes.get(id))
        .filter((n): n is TreeNode => !!n)
        .slice(-siblingWindow);
    }

    return { sessionId: args.sessionId, path: trimmedPath, siblings, currentId, strategy: 'state-tree' };
  }

  get size(): number {
    return this.nodes.size;
  }

  // ── Persistence (best-effort JSON snapshot) ──────────────────────────────

  private load(): void {
    try {
      if (!existsSync(this.persistPath)) return;
      const raw = JSON.parse(readFileSync(this.persistPath, 'utf-8')) as TreeSnapshot;
      if (raw?.v !== 1 || typeof raw.nodes !== 'object') return;
      this.nodes = new Map(Object.entries(raw.nodes));
      this.currentBySession = new Map(Object.entries(raw.currentBySession ?? {}));
      this.trajectorySession = new Map(Object.entries(raw.trajectorySession ?? {}));
    } catch {
      // Corrupt/unreadable snapshot — start fresh; the semantic trajectory
      // persistence in the 'trajectories' namespace is unaffected.
    }
  }

  private save(): void {
    try {
      const snapshot: TreeSnapshot = {
        v: 1,
        nodes: Object.fromEntries(this.nodes),
        currentBySession: Object.fromEntries(this.currentBySession),
        trajectorySession: Object.fromEntries(this.trajectorySession),
      };
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(snapshot), 'utf-8');
    } catch {
      // Best-effort — tree still lives in memory.
    }
  }
}

// ── Singleton (mirrors the lazy-singleton pattern used by model-router) ────

let treeInstance: TrajectoryTree | null = null;

export function getTrajectoryTree(persistPath?: string): TrajectoryTree {
  if (!treeInstance) treeInstance = new TrajectoryTree(persistPath);
  return treeInstance;
}

/** Test/reset hook — drops the singleton so the next get() reloads from disk. */
export function resetTrajectoryTree(): void {
  treeInstance = null;
}

export default TrajectoryTree;
