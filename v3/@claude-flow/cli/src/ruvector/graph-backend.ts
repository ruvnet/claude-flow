/**
 * @ruvector/graph-node native graph database backend (ADR-087)
 *
 * Provides persistent graph storage for agent relationships, causal edges,
 * task dependencies, and swarm topology using native Rust bindings.
 *
 * API requirements discovered via testing:
 * - createNode: requires { id, type, embedding }
 * - createEdge: requires { from, to, label, description, embedding, properties }
 * - createHyperedge: requires { nodes[], label, description, embedding, properties }
 * - kHopNeighbors(nodeId, k): returns string[] of node IDs
 * - stats(): returns { totalNodes, totalEdges, avgDegree }
 */

import { join } from 'path';

// Lazy-loaded graph-node module
let graphNodeModulePromise: Promise<any> | null = null;
let graphDbPromise: Promise<any> | null = null;
let graphBackendAvailable = false;

const DEFAULT_EMBEDDING_DIM = 8; // Minimal embedding for graph structure
const DEFAULT_DISTANCE_METRIC = 'Cosine';

/**
 * Load @ruvector/graph-node via createRequire (CJS package).
 *
 * The promise is the memo rather than a "loaded" flag. The flag was set
 * BEFORE its own `await`, so a caller arriving inside that window would take
 * the early return and read `graphNodeModule` while it was still `null`.
 * I could not make that window observable -- `import('module')` resolves a
 * builtin before another caller gets a turn -- so this is hardening on the
 * same shape as the open memo below, not a defect with a reproduction behind
 * it.
 */
async function loadGraphNode(): Promise<any> {
  if (!graphNodeModulePromise) {
    graphNodeModulePromise = (async () => {
      try {
        const { createRequire } = await import('module');
        const requireCjs = createRequire(import.meta.url);
        const mod = requireCjs('@ruvector/graph-node');
        graphBackendAvailable = true;
        return mod;
      } catch {
        graphBackendAvailable = false;
        return null;
      }
    })();
  }
  return graphNodeModulePromise;
}

/**
 * Report a graph-backend problem.
 *
 * No "already warned" flag: the open runs once per process because
 * `getGraphDb` memoizes the promise, and a second flag would only hide it if
 * that ever stopped being true.
 */
function warnGraphInit(message: string): void {
  console.warn(`[graph-backend] ${message}`);
}

/**
 * Whether this handle is actually backed by the file we asked for.
 *
 * `@ruvector/graph-node` 2.1.0 accepts a bare path STRING without throwing
 * and hands back a volatile in-memory instance -- `isPersistent() === false`,
 * `getStoragePath() === null`. Nothing downstream notices: writes succeed,
 * reads succeed, and the graph is gone at exit. Passing the options object
 * fixes that, and this check is what makes the fix self-reporting instead of
 * something a future signature change can quietly undo.
 *
 * A build that exposes neither accessor cannot be interrogated, so it is
 * accepted rather than refused -- this guards against a silent downgrade, not
 * against an unfamiliar version.
 */
function isPersistentAt(db: any, storagePath: string): boolean {
  const canReport =
    typeof db?.isPersistent === 'function' || typeof db?.getStoragePath === 'function';
  if (!canReport) return true;

  if (typeof db.isPersistent === 'function' && db.isPersistent() !== true) return false;
  if (typeof db.getStoragePath === 'function' && db.getStoragePath() !== storagePath) {
    return false;
  }
  return true;
}

/**
 * Open the graph database, or return null with a stated reason.
 *
 * The old fallback replaced an open failure with `new mod.GraphDatabase()` --
 * an empty in-memory graph that answers every query successfully and persists
 * nothing. A permission error, a lock held by another process and a healthy
 * database were indistinguishable from the outside. Callers already handle
 * `null` by degrading to `backend: 'unavailable'`, which is the honest shape
 * for "the graph is not there".
 */
async function openGraphDb(): Promise<any> {
  const mod = await loadGraphNode();
  if (!mod) return null;

  const dataDir = join(process.cwd(), '.claude-flow', 'graph');
  const storagePath = join(dataDir, 'agents.db');

  let db: any;
  try {
    const fs = await import('fs');
    fs.mkdirSync(dataDir, { recursive: true });
    // The options object, not the path string: see `isPersistentAt`.
    db = new mod.GraphDatabase({
      storagePath,
      dimensions: DEFAULT_EMBEDDING_DIM,
      distanceMetric: DEFAULT_DISTANCE_METRIC,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnGraphInit(`could not open ${storagePath}: ${reason}. Graph backend disabled.`);
    return null;
  }

  if (!isPersistentAt(db, storagePath)) {
    const reported =
      typeof db?.getStoragePath === 'function' ? db.getStoragePath() : 'unknown';
    warnGraphInit(
      `opened a non-persistent graph (storage path ${String(reported)}, wanted ${storagePath}). ` +
        'Graph backend disabled rather than writing to a graph that vanishes at exit.',
    );
    try {
      db?.close?.();
    } catch {
      // A handle we are already discarding.
    }
    return null;
  }

  return db;
}

/**
 * Get or create the singleton graph database instance.
 *
 * The promise is the singleton, not the handle: two callers racing the first
 * call used to each run the constructor, and the second overwrote the first's
 * `graphDb` while nodes were already being written through it.
 */
async function getGraphDb(): Promise<any> {
  if (!graphDbPromise) {
    graphDbPromise = openGraphDb().catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      warnGraphInit(`initialization failed: ${reason}. Graph backend disabled.`);
      return null;
    });
  }
  return graphDbPromise;
}

/**
 * Create a minimal embedding for non-vector graph operations.
 * Uses a deterministic hash of the string content.
 */
function textToMiniEmbedding(text: string): Float32Array {
  const emb = new Float32Array(DEFAULT_EMBEDDING_DIM);
  for (let i = 0; i < text.length; i++) {
    emb[i % DEFAULT_EMBEDDING_DIM] += text.charCodeAt(i) / 256;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < emb.length; i++) norm += emb[i] * emb[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < emb.length; i++) emb[i] /= norm;
  return emb;
}

// ============================================================================
// Public API
// ============================================================================

export interface GraphNodeData {
  id: string;
  type: string;
  name?: string;
  properties?: Record<string, unknown>;
}

export interface GraphEdgeData {
  from: string;
  to: string;
  label: string;
  description?: string;
  weight?: number;
  properties?: Record<string, unknown>;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  avgDegree: number;
  backend: 'graph-node' | 'unavailable';
}

/**
 * Check if graph-node backend is available
 */
export async function isGraphBackendAvailable(): Promise<boolean> {
  await loadGraphNode();
  return graphBackendAvailable;
}

/**
 * Add a node to the graph (agent, task, pattern, etc.)
 */
export async function addNode(data: GraphNodeData): Promise<string | null> {
  const db = await getGraphDb();
  if (!db) return null;
  try {
    const embedding = textToMiniEmbedding(`${data.type}:${data.name || data.id}`);
    return await db.createNode({
      id: data.id,
      type: data.type,
      ...data.properties,
      embedding,
    });
  } catch {
    return null;
  }
}

/**
 * Add an edge between two nodes
 */
export async function addEdge(data: GraphEdgeData): Promise<string | null> {
  const db = await getGraphDb();
  if (!db) return null;
  try {
    const embedding = textToMiniEmbedding(`${data.label}:${data.from}->${data.to}`);
    return await db.createEdge({
      from: data.from,
      to: data.to,
      label: data.label,
      description: data.description || data.label,
      embedding,
      properties: { weight: data.weight ?? 1.0, ...data.properties },
    });
  } catch {
    return null;
  }
}

/**
 * Create a hyperedge connecting multiple nodes (e.g., swarm teams)
 */
export async function addHyperedge(
  nodeIds: string[],
  label: string,
  description?: string,
  properties?: Record<string, unknown>,
): Promise<string | null> {
  const db = await getGraphDb();
  if (!db) return null;
  try {
    const embedding = textToMiniEmbedding(`${label}:${nodeIds.join(',')}`);
    return await db.createHyperedge({
      nodes: nodeIds,
      label,
      description: description || label,
      embedding,
      properties: properties || {},
    });
  } catch {
    return null;
  }
}

/**
 * Get k-hop neighbors of a node
 */
export async function getNeighbors(nodeId: string, hops: number = 2): Promise<string[]> {
  const db = await getGraphDb();
  if (!db) return [];
  try {
    return await db.kHopNeighbors(nodeId, hops);
  } catch {
    return [];
  }
}

/**
 * Get graph statistics
 */
export async function getGraphStats(): Promise<GraphStats> {
  const db = await getGraphDb();
  if (!db) return { totalNodes: 0, totalEdges: 0, avgDegree: 0, backend: 'unavailable' };
  try {
    const stats = await db.stats();
    return { ...stats, backend: 'graph-node' };
  } catch {
    return { totalNodes: 0, totalEdges: 0, avgDegree: 0, backend: 'unavailable' };
  }
}

/**
 * Record a causal edge (used by agentdb_causal-edge MCP tool)
 */
export async function recordCausalEdge(
  sourceId: string,
  targetId: string,
  relation: string,
  weight?: number,
): Promise<{ success: boolean; edgeId?: string; backend: string }> {
  // Ensure both nodes exist
  await addNode({ id: sourceId, type: 'memory-entry' });
  await addNode({ id: targetId, type: 'memory-entry' });

  const edgeId = await addEdge({
    from: sourceId,
    to: targetId,
    label: relation,
    description: `${relation}: ${sourceId} -> ${targetId}`,
    weight,
  });

  return {
    success: edgeId !== null,
    edgeId: edgeId ?? undefined,
    backend: graphBackendAvailable ? 'graph-node' : 'unavailable',
  };
}

/**
 * Record agent collaboration (used by swarm coordination)
 */
export async function recordCollaboration(
  agentId: string,
  agentType: string,
  taskId: string,
  taskName: string,
): Promise<{ success: boolean }> {
  await addNode({ id: agentId, type: 'agent', name: agentType });
  await addNode({ id: taskId, type: 'task', name: taskName });
  const edgeId = await addEdge({
    from: agentId,
    to: taskId,
    label: 'assigned_to',
    description: `${agentType} works on ${taskName}`,
  });
  return { success: edgeId !== null };
}

/**
 * Record swarm team as a hyperedge
 */
export async function recordSwarmTeam(
  agentIds: string[],
  topology: string,
  taskDescription?: string,
): Promise<{ success: boolean; hyperedgeId?: string }> {
  const heId = await addHyperedge(
    agentIds,
    'swarm-team',
    taskDescription || `${topology} swarm with ${agentIds.length} agents`,
    { topology, agentCount: agentIds.length },
  );
  return { success: heId !== null, hyperedgeId: heId ?? undefined };
}
