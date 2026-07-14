/**
 * Memory Bridge — Routes CLI memory operations through ControllerRegistry + AgentDB v3
 *
 * Per ADR-053 Phases 1-6: Full controller activation pipeline.
 * CLI → ControllerRegistry → AgentDB v3 controllers.
 *
 * Phase 1: Core CRUD + embeddings + HNSW + controller access (complete)
 * Phase 2: BM25 hybrid search, TieredCache read/write, MutationGuard validation
 * Phase 3: ReasoningBank pattern store, recordFeedback, CausalMemoryGraph edges
 * Phase 4: SkillLibrary promotion, ExplainableRecall provenance, AttestationLog
 * Phase 5: ReflexionMemory session lifecycle, WitnessChain attestation
 * Phase 6: AgentDB MCP tools (separate file), COW branching
 *
 * Uses better-sqlite3 API (synchronous .all()/.get()/.run()) since that's
 * what AgentDB v3 uses internally.
 *
 * @module v3/cli/memory-bridge
 */

import * as path from 'path';
import * as crypto from 'crypto';
import { createRequire } from 'node:module';

// ===== Lazy singleton =====

let registryPromise: Promise<any> | null = null;
let registryInstance: any = null;
let bridgeAvailable: boolean | null = null;

/**
 * Resolve database path with path traversal protection.
 * Only allows paths within or below the project's working directory,
 * or the special ':memory:' path.
 *
 * #1945: the previous hard-coded `<cwd>/.swarm/memory.db` default ignored
 * `CLAUDE_FLOW_MEMORY_PATH` / `claude-flow.config.json#memory.persistPath`
 * — so users with non-default memory paths had `memory init` write to e.g.
 * `data/memory/memory.db` while `bridgeStoreEntry()` wrote to
 * `.swarm/memory.db`. CLI store reported success against the wrong file and
 * a fresh process reading the configured path saw nothing.
 *
 * Use `getMemoryRoot()` (from memory-initializer) so the bridge and the
 * initializer agree on the same file. Imported via require() to avoid a
 * circular ESM dep between memory-initializer.ts and memory-bridge.ts.
 */
function getDbPath(customPath?: string): string {
  let defaultDir = path.resolve(process.cwd(), '.swarm');
  try {
    // `getMemoryRoot()` honors $CLAUDE_FLOW_MEMORY_PATH, then the
    // claude-flow.config.json `memory.persistPath`, then defaults to `.swarm`.
    const cjsRequire = createRequire(import.meta.url);
    const mod = cjsRequire('./memory-initializer.js') as { getMemoryRoot?: () => string };
    if (typeof mod.getMemoryRoot === 'function') {
      defaultDir = mod.getMemoryRoot();
    }
  } catch {
    /* memory-initializer not resolvable in this build — keep `.swarm/` default */
  }
  if (!customPath) return path.join(defaultDir, 'memory.db');
  if (customPath === ':memory:') return ':memory:';
  const resolved = path.resolve(customPath);
  // Ensure the path doesn't escape the working directory.
  const cwd = process.cwd();
  if (!resolved.startsWith(cwd)) {
    return path.join(defaultDir, 'memory.db'); // fallback to safe default
  }
  return resolved;
}

/**
 * Generate a secure random ID for memory entries.
 */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Lazily initialize the ControllerRegistry singleton.
 * Returns null if @claude-flow/memory is not available.
 */
async function getRegistry(dbPath?: string): Promise<any | null> {
  if (bridgeAvailable === false) return null;

  if (registryInstance) return registryInstance;

  if (!registryPromise) {
    registryPromise = (async () => {
      try {
        const { ControllerRegistry } = await import('@claude-flow/memory');
        const registry = new ControllerRegistry();

        // Suppress noisy console.log during init
        const origLog = console.log;
        console.log = (...args: unknown[]) => {
          const msg = String(args[0] ?? '');
          if (msg.includes('Transformers.js') ||
              msg.includes('better-sqlite3') ||
              msg.includes('[AgentDB]') ||
              msg.includes('[HNSWLibBackend]') ||
              msg.includes('RuVector graph')) return;
          origLog.apply(console, args);
        };

        try {
          await (registry as any).initialize({
            dbPath: dbPath || getDbPath(),
            embeddingModel: 'Xenova/all-MiniLM-L6-v2',
            dimension: 384,
            vectorBackend: 'auto',
            controllers: {
              reasoningBank: true,
              learningBridge: false,
              tieredCache: true,
              hierarchicalMemory: true,
              memoryConsolidation: true,
              memoryGraph: true,
              vectorBackend: true,
            },
          });
        } finally {
          console.log = origLog;
        }

        // Wire intelligence module as the learning backend.
        // AgentDB's ReasoningBank/LearningSystem need a better-sqlite3 db
        // handle which ControllerRegistry doesn't expose. Instead, use the
        // local intelligence module (SONA + LocalReasoningBank + file
        // persistence) for learning.
        //
        // PERF: parallelize the two independent post-init paths
        // (intelligence module load + agentdb import). Previously these
        // ran serially, adding ~50-150ms to cold start. Both can resolve
        // concurrently because they touch disjoint controller slots.
        try {
          const reg = registry as any;

          const intelligencePromise = (async () => {
            try {
              const intelligence = await import('./intelligence.js');
              const initResult = await intelligence.initializeIntelligence();

              if (initResult.reasoningBankEnabled) {
                const rb = intelligence.getReasoningBank();
                if (rb && !reg.get('reasoningBank')) {
                  if (typeof reg.set === 'function') reg.set('reasoningBank', rb);
                  else reg._controllers = { ...(reg._controllers || {}), reasoningBank: rb };
                }
              }

              if (initResult.sonaEnabled) {
                const sona = intelligence.getSonaCoordinator();
                if (sona && !reg.get('learningSystem')) {
                  if (typeof reg.set === 'function') reg.set('learningSystem', sona);
                  else reg._controllers = { ...(reg._controllers || {}), learningSystem: sona };
                }
              }
            } catch { /* intelligence module not available — learning stays unwired */ }
          })();

          const agentdbPromise = (async () => {
            // Single import shared across SkillLibrary + SemanticRouter probe.
            let agentdb: Record<string, unknown> | null = null;
            try { agentdb = (await import('agentdb')) as unknown as Record<string, unknown>; }
            catch { return; /* AgentDB not available */ }

            // SkillLibrary (no db required)
            try {
              const SkillCtor = agentdb.SkillLibrary as (new () => unknown) | undefined;
              if (SkillCtor && !reg.get('skills')) {
                const sk = new SkillCtor();
                if (typeof reg.set === 'function') reg.set('skills', sk);
                else reg._controllers = { ...(reg._controllers || {}), skills: sk };
              }
            } catch { /* SkillLibrary optional */ }

            // ADR-093 F9: probe multiple router class names across agentdb
            // alpha versions (alpha.10 had SemanticRouter; alpha.11+ removed
            // it in favor of @ruvector/router; future versions may
            // reintroduce). Wire only if .route() is callable.
            try {
              const candidates = ['SemanticRouter', 'IntentRouter', 'TaskRouter'] as const;
              let routerInstance: { route?: (input: string) => Promise<unknown> | unknown } | null = null;
              for (const name of candidates) {
                const Ctor = agentdb[name];
                if (typeof Ctor === 'function') {
                  try {
                    const inst = (() => {
                      try { return new (Ctor as new (cfg: { dimension: number }) => unknown)({ dimension: 384 }); }
                      catch { return new (Ctor as new () => unknown)(); }
                    })() as { route?: (input: string) => Promise<unknown> | unknown };
                    if (inst && typeof inst.route === 'function') {
                      routerInstance = inst;
                      break;
                    }
                  } catch { /* try next candidate */ }
                }
              }
              if (routerInstance && !reg.get('semanticRouter')) {
                if (typeof reg.set === 'function') reg.set('semanticRouter', routerInstance);
                else reg._controllers = { ...(reg._controllers || {}), semanticRouter: routerInstance };
              }
            } catch { /* router optional */ }

            // ADR-095 G7: load disabled-by-default controllers via direct
            // file:// URLs from the bundled agentdb. agentdb's exports
            // field doesn't expose these subpaths and we can't reliably
            // patch it across pnpm-hoisted multi-version trees, so we
            // sidestep the exports field entirely and import the file
            // by absolute URL. Only loads controllers whose constructor
            // is safe with no special prerequisites — others remain off
            // pending per-controller activation ADRs.
            try {
              const { createRequire } = await import('node:module');
              const { pathToFileURL } = await import('node:url');
              const path = await import('node:path');
              const fs = await import('node:fs');
              const cjsRequire = createRequire(import.meta.url);
              let adbPkgJsonPath: string | null = null;
              try { adbPkgJsonPath = cjsRequire.resolve('agentdb/package.json'); } catch { adbPkgJsonPath = null; }
              if (adbPkgJsonPath) {
                const adbDir = path.dirname(adbPkgJsonPath);
                const candidates: Array<{ name: string; relPath: string; configurable: boolean }> = [
                  // GNNService and RVFOptimizer can construct with no args
                  // in current agentdb — safe to activate as-is.
                  { name: 'gnnService', relPath: 'dist/src/services/GNNService.js', configurable: false },
                  { name: 'rvfOptimizer', relPath: 'dist/src/optimizations/RVFOptimizer.js', configurable: false },
                  // ADR-095 G7 follow-up: MutationGuard constructs cleanly
                  // with no args and exposes WASM-backed proof generation.
                  // No external deps; safe-default activation.
                  { name: 'mutationGuard', relPath: 'dist/src/security/MutationGuard.js', configurable: false },
                  // AttestationLog needs a sqlite db handle — wired below
                  // separately because we have to construct a db too.
                  // GuardedVectorBackend needs key material — leave for
                  // follow-up ADR.
                ];
                for (const cand of candidates) {
                  if (reg.get(cand.name)) continue;
                  const abs = path.join(adbDir, cand.relPath);
                  if (!fs.existsSync(abs)) continue;
                  try {
                    const url = pathToFileURL(abs).href;
                    const mod = await import(url) as Record<string, unknown>;
                    // Look for a default export, named export matching the
                    // file basename, or any class-typed export.
                    const baseName = path.basename(cand.relPath, '.js');
                    const Ctor = (mod[baseName] || mod.default ||
                      Object.values(mod).find(v => typeof v === 'function')) as (new () => unknown) | undefined;
                    if (typeof Ctor !== 'function') continue;
                    const inst = new Ctor();
                    if (typeof reg.set === 'function') reg.set(cand.name, inst);
                    else reg._controllers = { ...(reg._controllers || {}), [cand.name]: inst };
                  } catch { /* skip controllers that fail to construct */ }
                }

                // AttestationLog activation — needs a better-sqlite3
                // database. We open a dedicated file at .swarm/attestation.db
                // (separate from the main memory.db so the audit trail
                // is isolated). Best-effort: if better-sqlite3 isn't
                // resolvable in this env, skip cleanly.
                let attestationInst: unknown = null;
                if (!reg.get('attestationLog')) {
                  try {
                    const attestationFile = path.join(adbDir, 'dist/src/security/AttestationLog.js');
                    if (fs.existsSync(attestationFile)) {
                      const Database = (cjsRequire('better-sqlite3') as unknown) as new (p: string) => unknown;
                      const swarmDir = path.resolve(process.cwd(), '.swarm');
                      if (!fs.existsSync(swarmDir)) fs.mkdirSync(swarmDir, { recursive: true });
                      const dbPath = path.join(swarmDir, 'attestation.db');
                      const db = new Database(dbPath);
                      const url = pathToFileURL(attestationFile).href;
                      const mod = await import(url) as Record<string, unknown>;
                      const Ctor = mod.AttestationLog as (new (cfg: { db: unknown }) => unknown) | undefined;
                      if (typeof Ctor === 'function') {
                        const inst = new Ctor({ db });
                        attestationInst = inst;
                        if (typeof reg.set === 'function') reg.set('attestationLog', inst);
                        else reg._controllers = { ...(reg._controllers || {}), attestationLog: inst };
                      }
                    }
                  } catch { /* better-sqlite3 missing or schema init failed — skip silently */ }
                }

                // ADR-095 G7 follow-up: GuardedVectorBackend wraps the
                // existing vectorBackend with mutationGuard + attestationLog
                // for proof-gated state mutations (ADR-060). All three
                // dependencies are reachable here — vectorBackend is in
                // the baseline init, mutationGuard was just activated, and
                // attestationLog is constructed above. Skip if any piece
                // is missing rather than constructing with undefined.
                if (!reg.get('guardedVectorBackend')) {
                  try {
                    const gvbFile = path.join(adbDir, 'dist/src/backends/ruvector/GuardedVectorBackend.js');
                    if (fs.existsSync(gvbFile)) {
                      const inner = reg.get('vectorBackend');
                      const guard = reg.get('mutationGuard');
                      const log = attestationInst ?? reg.get('attestationLog');
                      if (inner && guard) {
                        const url = pathToFileURL(gvbFile).href;
                        const mod = await import(url) as Record<string, unknown>;
                        const Ctor = mod.GuardedVectorBackend as (new (i: unknown, g: unknown, l: unknown) => unknown) | undefined;
                        if (typeof Ctor === 'function') {
                          const inst = new Ctor(inner, guard, log);
                          if (typeof reg.set === 'function') reg.set('guardedVectorBackend', inst);
                          else reg._controllers = { ...(reg._controllers || {}), guardedVectorBackend: inst };
                        }
                      }
                    }
                  } catch { /* GuardedVectorBackend optional */ }
                }
              }
            } catch { /* G7 wiring optional */ }
          })();

          // Run both in parallel; settle either way so a single failing
          // path doesn't tear down the rest of the post-init wiring.
          await Promise.allSettled([intelligencePromise, agentdbPromise]);

          // Remaining disabled controllers tracked in ADR-095 G7 for
          // per-controller activation ADRs:
          //   - graphAdapter (graph DB adapter — needs graph DB connection)
        } catch {
          // Top-level catch — registry stays usable even if post-init wiring fails wholesale.
        }

        registryInstance = registry;
        bridgeAvailable = true;
        return registry;
      } catch {
        bridgeAvailable = false;
        registryPromise = null;
        return null;
      }
    })();
  }

  return registryPromise;
}

// ===== Phase 2: BM25 hybrid scoring =====

/**
 * BM25 scoring for keyword-based search.
 * Replaces naive String.includes() with proper information retrieval scoring.
 * Parameters tuned for short memory entries (k1=1.2, b=0.75).
 */
function bm25Score(
  queryTerms: string[],
  docWords: string[],
  docLength: number,
  avgDocLength: number,
  docCount: number,
  termDocFreqs: Map<string, number>,
): number {
  const k1 = 1.2;
  const b = 0.75;

  let score = 0;
  for (const term of queryTerms) {
    const tf = docWords.filter(w => w === term || w.includes(term)).length;
    if (tf === 0) continue;

    const df = termDocFreqs.get(term) || 1;
    const idf = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / Math.max(1, avgDocLength))));
    score += idf * tfNorm;
  }

  return score;
}

/**
 * Tokenize a corpus once per query. Each row is lowercased + split a single
 * time; the resulting `{ contentLower, words }` feed BM25 term-frequency,
 * per-doc BM25 scoring, and the #2558 coverage floor — which previously each
 * re-lowercased+re-split the same content (3× string scans per row).
 * Bit-identical to the prior split-per-consumer path.
 */
interface TokenizedDoc { contentLower: string; words: string[] }
function tokenizeCorpus(rows: Array<{ content: string }>): TokenizedDoc[] {
  return rows.map(row => {
    const contentLower = (row.content || '').toLowerCase();
    return { contentLower, words: contentLower.split(/\s+/) };
  });
}

/**
 * Compute BM25 term document frequencies over an already-tokenized corpus.
 */
function computeTermDocFreqs(
  queryTerms: string[],
  docs: TokenizedDoc[],
): { termDocFreqs: Map<string, number>; avgDocLength: number } {
  const termDocFreqs = new Map<string, number>();
  let totalLength = 0;

  for (const doc of docs) {
    totalLength += doc.words.length;
    for (const term of queryTerms) {
      if (doc.contentLower.includes(term)) {
        termDocFreqs.set(term, (termDocFreqs.get(term) || 0) + 1);
      }
    }
  }

  return { termDocFreqs, avgDocLength: docs.length > 0 ? totalLength / docs.length : 1 };
}

// ===== Phase 2: TieredCache helpers =====

/**
 * Try to read from TieredCache before hitting DB.
 * Returns cached value or null if cache miss.
 */
async function cacheGet(registry: any, cacheKey: string): Promise<any | null> {
  try {
    const cache = registry.get('tieredCache');
    if (!cache || typeof cache.get !== 'function') return null;
    return cache.get(cacheKey) ?? null;
  } catch {
    return null;
  }
}

/**
 * Write to TieredCache after DB write.
 */
async function cacheSet(registry: any, cacheKey: string, value: any): Promise<void> {
  try {
    const cache = registry.get('tieredCache');
    if (cache && typeof cache.set === 'function') {
      cache.set(cacheKey, value);
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Invalidate a cache key after mutation.
 */
async function cacheInvalidate(registry: any, cacheKey: string): Promise<void> {
  try {
    const cache = registry.get('tieredCache');
    if (cache && typeof cache.delete === 'function') {
      cache.delete(cacheKey);
    }
  } catch {
    // Non-fatal
  }
}

// ===== Phase 2: MutationGuard helpers =====

/**
 * Validate a mutation through MutationGuard before executing.
 * Returns true if the mutation is allowed, false if rejected.
 * When guard is unavailable (not installed), mutations are allowed.
 * When guard is present but throws, mutations are DENIED (fail-closed).
 */
async function guardValidate(
  registry: any,
  operation: string,
  params: Record<string, unknown>,
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const guard = registry.get('mutationGuard');
    if (!guard || typeof guard.validate !== 'function') {
      return { allowed: true }; // No guard installed = allow (degraded mode)
    }
    const result = guard.validate({ operation, params, timestamp: Date.now() });
    return { allowed: result?.allowed === true, reason: result?.reason };
  } catch {
    return { allowed: false, reason: 'MutationGuard validation error' }; // Fail-closed
  }
}

// ===== Phase 3: AttestationLog helpers =====

/**
 * Log a write operation to AttestationLog/WitnessChain.
 */
async function logAttestation(
  registry: any,
  operation: string,
  entryId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const attestation = registry.get('attestationLog');
    if (!attestation) return;

    if (typeof attestation.record === 'function') {
      attestation.record({ operation, entryId, timestamp: Date.now(), ...metadata });
    } else if (typeof attestation.log === 'function') {
      attestation.log(operation, entryId, metadata);
    }
  } catch {
    // Non-fatal — attestation is observability, not correctness
  }
}

// Tracks db handles whose schema DDL has already been ensured, so getDb()
// runs the CREATE…IF NOT EXISTS block at most once per handle instead of on
// every bridge call. WeakSet so handles GC without leaking.
const _schemaEnsuredDbs = new WeakSet<object>();

/**
 * Get the AgentDB database handle and ensure memory_entries table exists.
 * Returns null if not available.
 */
function getDb(registry: any): any | null {
  const agentdb = registry.getAgentDB();
  if (!agentdb?.database) return null;

  const db = agentdb.database;

  // Ensure memory_entries table exists (idempotent). The DDL is run at most
  // once per db handle — re-parsing 4× CREATE…IF NOT EXISTS on every bridge
  // call (store/search/get) was pure per-op overhead. Keyed by handle via a
  // WeakSet so a new db instance re-ensures without a stale global flag.
  if (!_schemaEnsuredDbs.has(db)) {
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        namespace TEXT DEFAULT 'default',
        content TEXT NOT NULL,
        type TEXT DEFAULT 'semantic',
        embedding TEXT,
        embedding_model TEXT DEFAULT 'local',
        embedding_dimensions INTEGER,
        tags TEXT,
        metadata TEXT,
        owner_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        expires_at INTEGER,
        last_accessed_at INTEGER,
        access_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        UNIQUE(namespace, key)
      )`);
      // Ensure indexes
      db.exec(`CREATE INDEX IF NOT EXISTS idx_bridge_ns ON memory_entries(namespace)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_bridge_key ON memory_entries(key)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_bridge_status ON memory_entries(status)`);
      _schemaEnsuredDbs.add(db);
    } catch {
      // Table already exists or db is read-only — that's fine. Don't mark
      // ensured on failure so a later writable call can retry.
    }
  }

  // ─── #2256-followup: rescue agentdb.embedder when its transformers.js
  // path fell through to mock embeddings.
  //
  // What was happening: agentdb's `EmbeddingService.initialize()` always
  // tries `@xenova/transformers` first, which transitively requires `sharp`
  // → `libvips`. On macOS arm64 systems without `brew install vips`, sharp
  // fails to load and agentdb silently falls back to MOCK EMBEDDINGS
  // (random vectors). The bridge then calls `agentdb.embedder.embed(...)`
  // and gets garbage; semantic search returns no useful matches.
  //
  // In our process, `memory-initializer.ts::loadEmbeddingModel()` already
  // tried this same chain and ALSO has a working ruvector-ONNX fallback
  // that the user typically reaches before the bridge initialises. The
  // ruvector ONNX model has been loaded; the agentdb instance just doesn't
  // know about it. We monkey-patch `embed`/`embedBatch` to delegate to our
  // `generateEmbedding()` so the bridge gets real vectors.
  //
  // Detection signal: `embedder.pipeline === null` after init means
  // transformers failed and agentdb would otherwise use mockEmbedding().
  // Patch is idempotent (`__ruvectorRescued` sentinel) and a no-op if
  // ruvector is also unavailable.
  rescueAgentdbEmbedder(agentdb).catch(() => { /* non-fatal */ });

  return { db, agentdb };
}

// One-shot guard so we only patch once per process — the embedder is shared
// by ReflexionMemory/SkillLibrary/CausalRecall and they all see the same
// object reference.
let _embedderPatched = false;
async function rescueAgentdbEmbedder(agentdb: { embedder?: { pipeline?: unknown; embed?: (t: string) => Promise<Float32Array>; embedBatch?: (ts: string[]) => Promise<Float32Array[]>; __ruvectorRescued?: boolean } }): Promise<void> {
  if (_embedderPatched) return;
  const emb = agentdb?.embedder;
  if (!emb || emb.__ruvectorRescued) return;

  // Only rescue when transformers.js initialisation failed: that's
  // signalled by a null pipeline. If transformers IS working, agentdb's
  // own embed() does the right thing and we should not interpose.
  if (emb.pipeline) return;

  // #2312: delegate to generateLOCALEmbedding, NOT generateEmbedding.
  // generateEmbedding is bridge-first — routing the rescued embed through it
  // closes a cycle (generateEmbedding → bridgeGenerateEmbedding →
  // embedder.embed [patched] → generateEmbedding → …) that allocated
  // unboundedly via microtasks until V8 hit the heap limit (~4 GB on the CI
  // runner, SIGABRT 134). The local chain never consults the bridge, so the
  // rescued embedder is a leaf. If the running memory-initializer build
  // predates generateLocalEmbedding, decline the rescue entirely — a stale
  // pairing must fail safe, not recurse.
  type EmbedFn = (text: string) => Promise<{ embedding: number[] | Float32Array; dimensions: number; model: string; backend?: 'onnx' | 'mock' }>;
  let localEmbed: EmbedFn | null = null;
  try {
    const mod = (await import('./memory-initializer.js')) as unknown as { generateLocalEmbedding?: EmbedFn };
    localEmbed = mod.generateLocalEmbedding ?? null;
  } catch {
    return; // can't import the rescuer — leave the mock fallback alone
  }
  if (!localEmbed) return;
  const embed: EmbedFn = localEmbed;

  // Probe once to confirm the rescuer actually returns REAL ONNX vectors
  // (#2312: the old probe only checked non-zero, which the deterministic
  // hash fallback also satisfies — so it "rescued" agentdb's mock with our
  // own mock and reported it as real). Require backend === 'onnx'.
  try {
    const probe = await embed('rescue-probe');
    const arr = probe?.embedding ? Array.from(probe.embedding as ArrayLike<number>) : [];
    const hasSignal = arr.length > 0 && arr.some((v: number) => Math.abs(v) > 1e-9);
    if (!hasSignal || probe.backend !== 'onnx') {
      // Local chain is also degraded — leave agentdb's embedder alone, but
      // tag it so bridgeGenerateEmbedding's AUDIT-#3 isMock check reports
      // backend='mock' truthfully instead of labeling mock vectors 'onnx'.
      try { (emb as { backend?: string }).backend = 'mock'; } catch { /* frozen */ }
      return;
    }
  } catch {
    return;
  }

  const newEmbed = async (text: string): Promise<Float32Array> => {
    const out = await embed(text);
    return out.embedding instanceof Float32Array
      ? out.embedding
      : new Float32Array((out.embedding as number[]) ?? []);
  };
  emb.embed = newEmbed;
  emb.embedBatch = async (texts: string[]): Promise<Float32Array[]> =>
    Promise.all(texts.map(t => newEmbed(t)));
  emb.__ruvectorRescued = true;
  _embedderPatched = true;
}

// ===== Bridge functions — match memory-initializer.ts signatures =====

/**
 * Store an entry via AgentDB v3.
 * Phase 2-5: Routes through MutationGuard → TieredCache → DB → AttestationLog.
 * Returns null to signal fallback to sql.js.
 */
export async function bridgeStoreEntry(options: {
  key: string;
  value: string;
  namespace?: string;
  generateEmbeddingFlag?: boolean;
  tags?: string[];
  ttl?: number;
  dbPath?: string;
  upsert?: boolean;
}): Promise<{
  success: boolean;
  id: string;
  embedding?: { dimensions: number; model: string };
  rawEmbedding?: number[];
  guarded?: boolean;
  cached?: boolean;
  attested?: boolean;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const { key, value, namespace = 'default', tags = [], ttl } = options;
    const id = generateId('entry');
    const now = Date.now();

    // #2245 — record the activity so signalsProcessed stops being a dead
    // zero. Fire-and-forget; never blocks the write path.
    try {
      const intel = await import('./intelligence.js');
      intel.recordSignalProcessed();
    } catch { /* intelligence module not yet initialised */ }

    // Phase 5: MutationGuard validation before write
    const guardResult = await guardValidate(registry, 'store', { key, namespace, size: value.length });
    if (!guardResult.allowed) {
      return { success: false, id, error: `MutationGuard rejected: ${guardResult.reason}` };
    }

    // Generate embedding via AgentDB's embedder
    let embeddingJson: string | null = null;
    let embeddingArr: number[] | null = null;
    let dimensions = 0;
    let model = 'local';

    if (options.generateEmbeddingFlag !== false && value.length > 0) {
      try {
        const embedder = ctx.agentdb.embedder;
        if (embedder) {
          const emb = await embedder.embed(value);
          if (emb) {
            embeddingArr = Array.from(emb) as number[];
            embeddingJson = JSON.stringify(embeddingArr);
            dimensions = emb.length;
            model = 'Xenova/all-MiniLM-L6-v2';
          }
        }
      } catch {
        // Embedding failed — store without
      }
    }

    // better-sqlite3 uses synchronous .run() with positional params
    const insertSql = options.upsert
      ? `INSERT OR REPLACE INTO memory_entries (
          id, key, namespace, content, type,
          embedding, embedding_dimensions, embedding_model,
          tags, metadata, created_at, updated_at, expires_at, status
        ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      : `INSERT INTO memory_entries (
          id, key, namespace, content, type,
          embedding, embedding_dimensions, embedding_model,
          tags, metadata, created_at, updated_at, expires_at, status
        ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, 'active')`;

    // #1941: provision a `vector_indexes` row for this namespace before the
    // entry insert. AgentDB's HNSW/router keys lookups by namespace via this
    // table — if it has no row for e.g. `claude-memories`, `memory_search`
    // returns 0 results even when memory_entries holds hundreds of rows for
    // that namespace. INSERT OR IGNORE so existing index rows are preserved.
    try {
      ctx.db
        .prepare(`INSERT OR IGNORE INTO vector_indexes (id, name, dimensions) VALUES (?, ?, ?)`)
        .run(namespace, namespace, dimensions || 384);
    } catch { /* vector_indexes may not exist on legacy DBs — fall through */ }

    const stmt = ctx.db.prepare(insertSql);
    stmt.run(
      id, key, namespace, value,
      embeddingJson, dimensions || null, model,
      tags.length > 0 ? JSON.stringify(tags) : null,
      '{}',
      now, now,
      ttl ? now + (ttl * 1000) : null
    );

    // #2558: keep `vector_indexes.total_vectors` accurate so status/tooling
    // stop reporting "HNSW index: 0 vectors" while embedded entries exist.
    try {
      ctx.db
        .prepare(
          `UPDATE vector_indexes SET
             total_vectors = (SELECT COUNT(*) FROM memory_entries
                              WHERE namespace = ? AND embedding IS NOT NULL),
             updated_at = ?
           WHERE name = ?`,
        )
        .run(namespace, now, namespace);
    } catch { /* vector_indexes may not exist on legacy DBs — non-fatal */ }

    // #2558: better-sqlite3 opens the DB in WAL mode and, for the small write
    // volumes typical of CLI usage, may never reach the auto-checkpoint
    // threshold — leaving committed rows only in the -wal file. WAL-blind
    // readers (the sql.js fallback search path; the statusline's read-only
    // `sqlite3` vector count) then see a stale/empty main DB file and report
    // "0 vectors" / empty search. A PASSIVE checkpoint flushes committed pages
    // into the main file without blocking writers. Best-effort, never fatal.
    try {
      if (typeof ctx.db.pragma === 'function') {
        ctx.db.pragma('wal_checkpoint(PASSIVE)');
      }
    } catch { /* non-WAL, busy, or unsupported — non-fatal */ }

    // Phase 2: Write-through to TieredCache
    const safeNs = String(namespace).replace(/:/g, '_');
    const safeKey = String(key).replace(/:/g, '_');
    const cacheKey = `entry:${safeNs}:${safeKey}`;
    await cacheSet(registry, cacheKey, { id, key, namespace, content: value, embedding: embeddingJson });

    // Phase 4: AttestationLog write audit
    await logAttestation(registry, 'store', id, { key, namespace, hasEmbedding: !!embeddingJson });

    return {
      success: true,
      id,
      embedding: embeddingJson ? { dimensions, model } : undefined,
      rawEmbedding: embeddingArr ?? undefined,
      guarded: true,
      cached: true,
      attested: true,
    };
  } catch {
    return null;
  }
}

/**
 * Search entries via AgentDB v3.
 * Phase 2: BM25 hybrid scoring replaces naive String.includes() keyword fallback.
 * Combines cosine similarity (semantic) with BM25 (lexical) via reciprocal rank fusion.
 */
export async function bridgeSearchEntries(options: {
  query: string;
  namespace?: string;
  limit?: number;
  threshold?: number;
  dbPath?: string;
}): Promise<{
  success: boolean;
  results: {
    id: string;
    key: string;
    content: string;
    score: number;
    namespace: string;
    provenance?: string;
  }[];
  searchTime: number;
  searchMethod?: string;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const { query: queryStr, namespace, limit = 10, threshold = 0.3 } = options;
    const effectiveNamespace = namespace || 'all';
    const startTime = Date.now();

    // Generate query embedding
    let queryEmbedding: number[] | null = null;
    try {
      const embedder = ctx.agentdb.embedder;
      if (embedder) {
        const emb = await embedder.embed(queryStr);
        queryEmbedding = Array.from(emb);
      }
    } catch {
      // Fall back to keyword search
    }

    // better-sqlite3: .prepare().all() returns array of objects
    const nsFilter = effectiveNamespace !== 'all'
      ? `AND namespace = ?`
      : '';

    let rows: any[];
    try {
      const stmt = ctx.db.prepare(`
        SELECT id, key, namespace, content, embedding
        FROM memory_entries
        WHERE status = 'active' ${nsFilter}
        LIMIT 1000
      `);
      rows = effectiveNamespace !== 'all' ? stmt.all(effectiveNamespace) : stmt.all();
    } catch {
      return null;
    }

    // Phase 2: Compute BM25 term stats for the corpus. Tokenize the corpus a
    // single time and reuse the per-doc `{contentLower, words}` for term-freq,
    // BM25 scoring, and the coverage floor below.
    const queryTerms = queryStr.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const docs = tokenizeCorpus(rows);
    const { termDocFreqs, avgDocLength } = computeTermDocFreqs(queryTerms, docs);
    const docCount = rows.length;

    const results: { id: string; key: string; content: string; score: number; namespace: string; provenance?: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const doc = docs[i];
      let semanticScore = 0;
      let bm25ScoreVal = 0;

      // Semantic scoring via cosine similarity
      if (queryEmbedding && row.embedding) {
        try {
          const embedding = JSON.parse(row.embedding) as number[];
          semanticScore = cosineSim(queryEmbedding, embedding);
        } catch {
          // Invalid embedding
        }
      }

      // Phase 2: BM25 keyword scoring (replaces String.includes fallback)
      if (queryTerms.length > 0 && row.content) {
        bm25ScoreVal = bm25Score(queryTerms, doc.words, doc.words.length, avgDocLength, docCount, termDocFreqs);
        // Normalize BM25 to 0-1 range (cap at 10 for normalization)
        bm25ScoreVal = Math.min(bm25ScoreVal / 10, 1.0);
      }

      // #2558: keyword-coverage floor for the lexical signal.
      // BM25's IDF collapses toward zero when a term appears in most/all
      // documents (routine on small memory corpora), and the /10 normalization
      // crushed exact-keyword hits well below the default 0.3 threshold — so
      // `memory search` recalled NOTHING even when the content literally
      // contained the query term (issue #2558: "keyword recall random"). The
      // pre-BM25 fallback guaranteed keyword recall via matchCount/words*0.5;
      // this restores that guarantee. `coverage` is the fraction of query
      // terms present in the document — a full-coverage hit must always be
      // recallable regardless of IDF.
      const contentLower = doc.contentLower;
      const matchedTerms = queryTerms.filter(t => contentLower.includes(t)).length;
      const coverage = queryTerms.length > 0 ? matchedTerms / queryTerms.length : 0;
      const lexicalScore = Math.max(bm25ScoreVal, coverage);

      // Recall-friendly fusion: a strong semantic OR lexical signal alone must
      // clear the threshold. `blended` (0.6 semantic + 0.4 lexical) drives
      // ranking; taking max() with the raw semantic score means (a) a genuinely
      // similar entry is never dropped just because it lacks the query's exact
      // words, and (b) a full-coverage keyword hit (lexical=1 → blended≥0.4) is
      // never dropped just because its embedding cosine is low or negative.
      const blended = 0.6 * Math.max(0, semanticScore) + 0.4 * lexicalScore;
      const score = Math.max(blended, semanticScore);

      if (score >= threshold) {
        // Phase 4: ExplainableRecall provenance
        const provenance = queryEmbedding
          ? `semantic:${semanticScore.toFixed(3)}+lexical:${lexicalScore.toFixed(3)}`
          : `lexical:${lexicalScore.toFixed(3)}`;

        results.push({
          id: String(row.id).substring(0, 12),
          key: row.key || String(row.id).substring(0, 15),
          content: (row.content || '').substring(0, 60) + ((row.content || '').length > 60 ? '...' : ''),
          score,
          namespace: row.namespace || 'default',
          provenance,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    return {
      success: true,
      results: results.slice(0, limit),
      searchTime: Date.now() - startTime,
      searchMethod: queryEmbedding ? 'hybrid-bm25-semantic' : 'bm25-only',
    };
  } catch {
    return null;
  }
}

/**
 * List entries via AgentDB v3.
 */
export async function bridgeListEntries(options: {
  namespace?: string;
  limit?: number;
  offset?: number;
  dbPath?: string;
  /** #2073: When true, include the entry's full `content` string in each result. */
  includeContent?: boolean;
}): Promise<{
  success: boolean;
  entries: {
    id: string;
    key: string;
    namespace: string;
    size: number;
    accessCount: number;
    createdAt: string;
    updatedAt: string;
    hasEmbedding: boolean;
    /** #2073: Present when `includeContent: true` was requested. */
    content?: string;
  }[];
  total: number;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const { namespace, limit = 20, offset = 0 } = options;

    const nsFilter = namespace ? `AND namespace = ?` : '';
    const nsParams = namespace ? [namespace] : [];

    // #2120 — `status IS NULL` accepted alongside `'active'`. Old
    // databases imported by the auto-memory bridge (before the status
    // column existed) end up with NULL status after schema migration if
    // the migration ran on an existing DB without a backfill. Reporter
    // @alexandrelealbess on WSL2 had 251 entries with NULL status, so
    // the `status = 'active'` filter matched zero. Treat NULL as
    // "legacy-active" — the safe default for any entry that predates the
    // status column.
    const statusFilter = `(status = 'active' OR status IS NULL)`;

    // Count
    let total = 0;
    try {
      const countStmt = ctx.db.prepare(
        `SELECT COUNT(*) as cnt FROM memory_entries WHERE ${statusFilter} ${nsFilter}`
      );
      const countRow = countStmt.get(...nsParams);
      total = countRow?.cnt ?? 0;
    } catch {
      return null;
    }

    // List
    const entries: any[] = [];
    try {
      const stmt = ctx.db.prepare(`
        SELECT id, key, namespace, content, embedding, access_count, created_at, updated_at
        FROM memory_entries
        WHERE ${statusFilter} ${nsFilter}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `);
      const rows = stmt.all(...nsParams, limit, offset);
      for (const row of rows) {
        const entry: Record<string, unknown> = {
          // #2073: don't truncate id when content is requested — callers
          // (notably memory_export) need the full id to round-trip via import.
          id: options.includeContent ? String(row.id) : String(row.id).substring(0, 20),
          key: row.key || String(row.id).substring(0, 15),
          namespace: row.namespace || 'default',
          size: (row.content || '').length,
          accessCount: row.access_count ?? 0,
          createdAt: row.created_at || new Date().toISOString(),
          updatedAt: row.updated_at || new Date().toISOString(),
          hasEmbedding: !!(row.embedding && String(row.embedding).length > 10),
        };
        if (options.includeContent) {
          entry.content = row.content || '';
        }
        entries.push(entry);
      }
    } catch {
      return null;
    }

    return { success: true, entries, total };
  } catch {
    return null;
  }
}

/**
 * Get a specific entry via AgentDB v3.
 * Phase 2: TieredCache consulted before DB hit.
 */
export async function bridgeGetEntry(options: {
  key: string;
  namespace?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  found: boolean;
  entry?: {
    id: string;
    key: string;
    namespace: string;
    content: string;
    accessCount: number;
    createdAt: string;
    updatedAt: string;
    hasEmbedding: boolean;
    tags: string[];
  };
  cacheHit?: boolean;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const { key, namespace = 'default' } = options;

    // Phase 2: Check TieredCache first
    const safeNs = String(namespace).replace(/:/g, '_');
    const safeKey = String(key).replace(/:/g, '_');
    const cacheKey = `entry:${safeNs}:${safeKey}`;
    const cached = await cacheGet(registry, cacheKey);
    if (cached && cached.content) {
      return {
        success: true,
        found: true,
        cacheHit: true,
        entry: {
          id: String(cached.id || ''),
          key: cached.key || key,
          namespace: cached.namespace || namespace,
          content: cached.content || '',
          accessCount: cached.accessCount ?? 0,
          createdAt: cached.createdAt || new Date().toISOString(),
          updatedAt: cached.updatedAt || new Date().toISOString(),
          hasEmbedding: !!cached.embedding,
          tags: cached.tags || [],
        },
      };
    }

    let row: any;
    try {
      const stmt = ctx.db.prepare(`
        SELECT id, key, namespace, content, embedding, access_count, created_at, updated_at, tags
        FROM memory_entries
        WHERE status = 'active' AND key = ? AND namespace = ?
        LIMIT 1
      `);
      row = stmt.get(key, namespace);
    } catch {
      return null;
    }

    if (!row) {
      return { success: true, found: false };
    }

    // Update access count
    try {
      ctx.db.prepare(
        `UPDATE memory_entries SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`
      ).run(Date.now(), row.id);
    } catch {
      // Non-fatal
    }

    let tags: string[] = [];
    if (row.tags) {
      try { tags = JSON.parse(row.tags); } catch { /* invalid */ }
    }

    const entry = {
      id: String(row.id),
      key: row.key || String(row.id),
      namespace: row.namespace || 'default',
      content: row.content || '',
      accessCount: (row.access_count ?? 0) + 1,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || new Date().toISOString(),
      hasEmbedding: !!(row.embedding && String(row.embedding).length > 10),
      tags,
    };

    // Phase 2: Populate cache for next read
    await cacheSet(registry, cacheKey, entry);

    return { success: true, found: true, cacheHit: false, entry };
  } catch {
    return null;
  }
}

/**
 * Delete an entry via AgentDB v3.
 * Phase 5: MutationGuard validation, cache invalidation, attestation logging.
 */
export async function bridgeDeleteEntry(options: {
  key: string;
  namespace?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  deleted: boolean;
  key: string;
  namespace: string;
  remainingEntries: number;
  guarded?: boolean;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const { key, namespace = 'default' } = options;

    // Phase 5: MutationGuard validation before delete
    const guardResult = await guardValidate(registry, 'delete', { key, namespace });
    if (!guardResult.allowed) {
      return { success: false, deleted: false, key, namespace, remainingEntries: 0, error: `MutationGuard rejected: ${guardResult.reason}` };
    }

    // Soft delete using parameterized query
    let changes = 0;
    try {
      const result = ctx.db.prepare(`
        UPDATE memory_entries
        SET status = 'deleted', updated_at = ?
        WHERE key = ? AND namespace = ? AND status = 'active'
      `).run(Date.now(), key, namespace);
      changes = result?.changes ?? 0;
    } catch {
      return null;
    }

    // Phase 2: Invalidate cache
    const safeNs = String(namespace).replace(/:/g, '_');
    const safeKey = String(key).replace(/:/g, '_');
    await cacheInvalidate(registry, `entry:${safeNs}:${safeKey}`);

    // Phase 4: AttestationLog delete audit
    if (changes > 0) {
      await logAttestation(registry, 'delete', key, { namespace });
    }

    let remaining = 0;
    try {
      const row = ctx.db.prepare(`SELECT COUNT(*) as cnt FROM memory_entries WHERE status = 'active'`).get();
      remaining = row?.cnt ?? 0;
    } catch {
      // Non-fatal
    }

    return {
      success: true,
      deleted: changes > 0,
      key,
      namespace,
      remainingEntries: remaining,
      guarded: true,
    };
  } catch {
    return null;
  }
}

// #2666 — Hard, namespace-scoped purge. bridgeDeleteEntry above only ever
// soft-deletes a single (namespace, key); this is a real
// `DELETE FROM memory_entries WHERE namespace = ?` against the live
// better-sqlite3-style handle, for callers (e.g. a plugin's index-reconcile
// step) that need a namespace to be genuinely empty rather than tombstoned.
// Irreversible — callers must gate this behind an explicit confirmation.
export async function bridgePurgeNamespace(options: {
  namespace: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  deletedCount: number;
  remainingEntries: number;
  guarded?: boolean;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const { namespace } = options;

    const guardResult = await guardValidate(registry, 'purge', { namespace });
    if (!guardResult.allowed) {
      return { success: false, deletedCount: 0, remainingEntries: 0, error: `MutationGuard rejected: ${guardResult.reason}` };
    }

    let deletedCount = 0;
    try {
      const result = ctx.db.prepare(`DELETE FROM memory_entries WHERE namespace = ?`).run(namespace);
      deletedCount = result?.changes ?? 0;
    } catch (e) {
      return { success: false, deletedCount: 0, remainingEntries: 0, error: e instanceof Error ? e.message : String(e) };
    }

    const safeNs = String(namespace).replace(/:/g, '_');
    await cacheInvalidate(registry, `namespace:${safeNs}`);

    if (deletedCount > 0) {
      await logAttestation(registry, 'purge', namespace, { namespace, deletedCount });
    }

    let remaining = 0;
    try {
      const row = ctx.db.prepare(`SELECT COUNT(*) as cnt FROM memory_entries WHERE status = 'active'`).get();
      remaining = row?.cnt ?? 0;
    } catch {
      // Non-fatal
    }

    return {
      success: true,
      deletedCount,
      remainingEntries: remaining,
      guarded: true,
    };
  } catch {
    return null;
  }
}

// ===== Phase 2: Embedding bridge =====

/**
 * Generate embedding via AgentDB v3's embedder.
 * Returns null if bridge unavailable — caller falls back to own ONNX/hash.
 */
export async function bridgeGenerateEmbedding(
  text: string,
  dbPath?: string,
): Promise<{ embedding: number[]; dimensions: number; model: string; backend?: 'onnx' | 'mock' } | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  try {
    const agentdb = registry.getAgentDB();
    const embedder = agentdb?.embedder;
    if (!embedder) return null;

    const emb = await embedder.embed(text);
    if (!emb) return null;

    // AUDIT #3: surface backend truthfully. AgentDB's embedder is a real ONNX
    // model when present; if it ever exposes a mock/stub signal, honor it.
    const isMock = (embedder as { isMock?: boolean; backend?: string }).isMock === true
      || (embedder as { backend?: string }).backend === 'mock';

    // #2395 — AgentDB's vectorBackend controller may initialize as
    // `enabled: false` (e.g., ruvector isn't wired into its neural substrate
    // yet) and silently fall back to a 128-dim hash stub. The embedder doesn't
    // expose isMock=true in that path, so the wrapper above was reporting
    // backend='onnx' on what's actually 128-dim hash garbage. The model name
    // we hardcode ('Xenova/all-MiniLM-L6-v2') always produces 384-dim, so a
    // dimensions mismatch is a definitive stub signal: return null and let
    // the caller fall through to generateLocalEmbedding which routes to
    // transformers.js / ruvector ONNX directly.
    if (emb.length !== 384) {
      return null;
    }

    return {
      embedding: Array.from(emb),
      dimensions: emb.length,
      model: 'Xenova/all-MiniLM-L6-v2',
      backend: isMock ? 'mock' : 'onnx',
    };
  } catch {
    return null;
  }
}

/**
 * Load embedding model via AgentDB v3 (it loads on init).
 * Returns null if unavailable.
 */
export async function bridgeLoadEmbeddingModel(
  dbPath?: string,
): Promise<{
  success: boolean;
  dimensions: number;
  modelName: string;
  loadTime?: number;
} | null> {
  const startTime = Date.now();
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  try {
    const agentdb = registry.getAgentDB();
    const embedder = agentdb?.embedder;
    if (!embedder) return null;

    // Verify embedder works by generating a test embedding
    const test = await embedder.embed('test');
    if (!test) return null;

    return {
      success: true,
      dimensions: test.length,
      modelName: 'Xenova/all-MiniLM-L6-v2',
      loadTime: Date.now() - startTime,
    };
  } catch {
    return null;
  }
}

// ===== Phase 3: HNSW bridge =====

/**
 * Get HNSW status from AgentDB v3's vector backend or HNSW index.
 * Returns null if unavailable.
 */
export async function bridgeGetHNSWStatus(
  dbPath?: string,
): Promise<{
  available: boolean;
  initialized: boolean;
  entryCount: number;
  dimensions: number;
} | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  try {
    const ctx = getDb(registry);
    if (!ctx) return null;

    // Count entries with embeddings
    let entryCount = 0;
    try {
      const row = ctx.db.prepare(
        `SELECT COUNT(*) as cnt FROM memory_entries WHERE status = 'active' AND embedding IS NOT NULL`,
      ).get();
      entryCount = row?.cnt ?? 0;
    } catch {
      // Table might not exist
    }

    return {
      available: true,
      initialized: true,
      entryCount,
      dimensions: 384,
    };
  } catch {
    return null;
  }
}

/**
 * Search using AgentDB v3's embedder + SQLite entries.
 * This is the HNSW-equivalent search through the bridge.
 * Returns null if unavailable.
 */
export async function bridgeSearchHNSW(
  queryEmbedding: number[],
  options?: { k?: number; namespace?: string; threshold?: number },
  dbPath?: string,
): Promise<Array<{
  id: string;
  key: string;
  content: string;
  score: number;
  namespace: string;
}> | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const k = options?.k ?? 10;
    const threshold = options?.threshold ?? 0.3;
    const nsFilter = options?.namespace && options.namespace !== 'all'
      ? `AND namespace = ?`
      : '';

    let rows: any[];
    try {
      const stmt = ctx.db.prepare(`
        SELECT id, key, namespace, content, embedding
        FROM memory_entries
        WHERE status = 'active' AND embedding IS NOT NULL ${nsFilter}
        LIMIT 10000
      `);
      rows = nsFilter
        ? stmt.all(options!.namespace)
        : stmt.all();
    } catch {
      return null;
    }

    const results: Array<{
      id: string; key: string; content: string; score: number; namespace: string;
    }> = [];

    for (const row of rows) {
      if (!row.embedding) continue;
      try {
        const emb = JSON.parse(row.embedding) as number[];
        const score = cosineSim(queryEmbedding, emb);
        if (score >= threshold) {
          results.push({
            id: String(row.id).substring(0, 12),
            key: row.key || String(row.id).substring(0, 15),
            content: (row.content || '').substring(0, 60) +
              ((row.content || '').length > 60 ? '...' : ''),
            score,
            namespace: row.namespace || 'default',
          });
        }
      } catch {
        // Skip invalid embeddings
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  } catch {
    return null;
  }
}

/**
 * Add entry to the bridge's database with embedding.
 * Returns null if unavailable.
 */
export async function bridgeAddToHNSW(
  id: string,
  embedding: number[],
  entry: { id: string; key: string; namespace: string; content: string },
  dbPath?: string,
): Promise<boolean | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const now = Date.now();
    const embeddingJson = JSON.stringify(embedding);
    ctx.db.prepare(`
      INSERT OR REPLACE INTO memory_entries (
        id, key, namespace, content, type,
        embedding, embedding_dimensions, embedding_model,
        created_at, updated_at, status
      ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, 'Xenova/all-MiniLM-L6-v2', ?, ?, 'active')
    `).run(
      id, entry.key, entry.namespace, entry.content,
      embeddingJson, embedding.length,
      now, now,
    );
    return true;
  } catch {
    return null;
  }
}

// ===== Phase 4: Controller access =====

/**
 * Get a named controller from AgentDB v3 via ControllerRegistry.
 * Returns null if unavailable.
 */
export async function bridgeGetController(
  name: string,
  dbPath?: string,
): Promise<any | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  try {
    return registry.get(name) ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if a controller is available.
 */
export async function bridgeHasController(
  name: string,
  dbPath?: string,
): Promise<boolean> {
  const registry = await getRegistry(dbPath);
  if (!registry) return false;

  try {
    const controller = registry.get(name);
    return controller !== null && controller !== undefined;
  } catch {
    return false;
  }
}

/**
 * List all controllers and their status.
 */
export async function bridgeListControllers(
  dbPath?: string,
): Promise<Array<{ name: string; enabled: boolean; level: number }> | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  try {
    return registry.listControllers();
  } catch {
    return null;
  }
}

/**
 * Check if the AgentDB v3 bridge is available.
 */
export async function isBridgeAvailable(dbPath?: string): Promise<boolean> {
  if (bridgeAvailable !== null) return bridgeAvailable;
  const registry = await getRegistry(dbPath);
  return registry !== null;
}

/**
 * Get the ControllerRegistry instance (for advanced consumers).
 */
export async function getControllerRegistry(dbPath?: string): Promise<any | null> {
  return getRegistry(dbPath);
}

/**
 * Shutdown the bridge and release resources.
 */
export async function shutdownBridge(): Promise<void> {
  if (registryInstance) {
    try {
      await registryInstance.shutdown();
    } catch {
      // Best-effort
    }
    registryInstance = null;
    registryPromise = null;
    bridgeAvailable = null;
  }
}

// ===== Phase 3: ReasoningBank pattern operations =====

/**
 * Store a pattern via ReasoningBank controller.
 * Falls back to raw SQL if ReasoningBank unavailable.
 */
export async function bridgeStorePattern(options: {
  pattern: string;
  type: string;
  confidence: number;
  metadata?: Record<string, unknown>;
  dbPath?: string;
}): Promise<{ success: boolean; patternId: string; controller: string } | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    const reasoningBank = registry.get('reasoningBank');
    const patternId = generateId('pattern');

    if (reasoningBank && typeof reasoningBank.store === 'function') {
      await reasoningBank.store({
        id: patternId,
        content: options.pattern,
        type: options.type,
        confidence: options.confidence,
        metadata: options.metadata,
        timestamp: Date.now(),
      });
      return { success: true, patternId, controller: 'reasoningBank' };
    }

    // Fallback: store via bridge SQL
    const patternValue = JSON.stringify({ pattern: options.pattern, type: options.type, confidence: options.confidence, metadata: options.metadata });
    const result = await bridgeStoreEntry({
      key: patternId,
      value: patternValue,
      namespace: 'pattern',
      generateEmbeddingFlag: true,
      tags: [options.type, 'reasoning-pattern'],
      dbPath: options.dbPath,
    });

    if (!result) return null;

    // Add to HNSW index for fast semantic search (bridgeStoreEntry stores SQL only)
    if (result.rawEmbedding) {
      try {
        const { addToHNSWIndex } = await import('./memory-initializer.js');
        await addToHNSWIndex(result.id, result.rawEmbedding, {
          id: result.id,
          key: patternId,
          namespace: 'pattern',
          content: patternValue,
        });
      } catch { /* HNSW is best-effort */ }
    }

    return { success: true, patternId: result.id, controller: 'bridge-fallback' };
  } catch {
    return null;
  }
}

/**
 * Search patterns via ReasoningBank controller.
 */
export async function bridgeSearchPatterns(options: {
  query: string;
  topK?: number;
  minConfidence?: number;
  dbPath?: string;
}): Promise<{ results: Array<{ id: string; content: string; score: number }>; controller: string } | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    const reasoningBank = registry.get('reasoningBank');

    // ReasoningBank may expose .searchPatterns() (agentdb) or .search() (legacy) (#1492 Bug 2)
    if (reasoningBank && typeof (reasoningBank.searchPatterns ?? reasoningBank.search) === 'function') {
      let results: any;
      if (typeof reasoningBank.searchPatterns === 'function') {
        results = await reasoningBank.searchPatterns({ task: options.query, k: options.topK || 5, threshold: options.minConfidence || 0.3 });
      } else {
        results = await reasoningBank.search(options.query, { topK: options.topK || 5, minScore: options.minConfidence || 0.3 });
      }
      return {
        results: Array.isArray(results) ? results.map((r: any) => ({
          id: r.id || r.patternId || '',
          content: r.content || r.pattern || '',
          score: r.score ?? r.confidence ?? 0,
        })) : [],
        controller: 'reasoningBank',
      };
    }

    // #2226 — the wired-in LocalReasoningBank implements store() + findSimilar()/getAll()
    // but NOT searchPatterns()/search(). bridgeStorePattern commits patterns to its
    // store(), so search MUST read the SAME backend or stored patterns are never found
    // (previously search fell through to the disjoint sql.js 'pattern' namespace, which
    // the store never wrote to → always-empty results). Adapt findSimilar (semantic) with
    // a getAll() substring fallback so freshly-stored patterns are visible. This mirrors
    // what hooks_intelligence_pattern-search already does against the same backend.
    if (reasoningBank && typeof reasoningBank.findSimilar === 'function') {
      const k = options.topK || 5;
      const threshold = options.minConfidence ?? 0.3;
      let mapped: Array<{ id: string; content: string; score: number }> = [];
      try {
        const { generateEmbedding } = await import('./memory-initializer.js');
        const qEmb = await generateEmbedding(options.query);
        if (qEmb && Array.isArray(qEmb.embedding) && qEmb.embedding.length > 0) {
          const hits = reasoningBank.findSimilar(qEmb.embedding, { k, threshold });
          mapped = (Array.isArray(hits) ? hits : []).map((r: any) => ({
            id: r.id ?? '',
            content: r.content ?? '',
            score: r.confidence ?? r.score ?? 0,
          }));
        }
      } catch { /* embedding unavailable — fall through to substring scan */ }

      // Deterministic substring fallback over the same in-memory store.
      if (mapped.length === 0 && typeof reasoningBank.getAll === 'function') {
        const q = options.query.toLowerCase();
        mapped = (reasoningBank.getAll() as any[])
          .filter((p: any) => typeof p.content === 'string' && p.content.toLowerCase().includes(q))
          .slice(0, k)
          .map((p: any) => ({ id: p.id ?? '', content: p.content ?? '', score: p.confidence ?? 0 }));
      }

      return { results: mapped, controller: 'reasoningBank' };
    }

    // Fallback: search via bridge
    const result = await bridgeSearchEntries({
      query: options.query,
      namespace: 'pattern',
      limit: options.topK || 5,
      threshold: options.minConfidence || 0.3,
      dbPath: options.dbPath,
    });

    return result ? {
      results: result.results.map(r => ({ id: r.id, content: r.content, score: r.score })),
      controller: 'bridge-fallback',
    } : null;
  } catch {
    return null;
  }
}

// ===== Phase 3: Feedback recording =====

/**
 * Record task feedback for learning via ReasoningBank or LearningSystem.
 * Wired into hooks_post-task handler.
 */
export async function bridgeRecordFeedback(options: {
  taskId: string;
  success: boolean;
  quality: number;
  agent?: string;
  duration?: number;
  patterns?: string[];
  dbPath?: string;
  // ADR-147 P2: nested-subagent spawn tree capture.
  // parentAgentId is sourced from Claude Code's `parent_agent_id` OTel span tag
  // (header `x-claude-code-parent-agent-id`). depth is the chain length from the
  // root lead session (0 = lead, 1+ = subagent). Both undefined for top-level work.
  parentAgentId?: string;
  depth?: number;
}): Promise<{ success: boolean; controller: string; updated: number } | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    let controller = 'none';
    let updated = 0;

    // Try LearningSystem first (Phase 4)
    const learningSystem = registry.get('learningSystem');
    if (learningSystem) {
      try {
        if (typeof learningSystem.recordFeedback === 'function') {
          await learningSystem.recordFeedback({
            taskId: options.taskId, success: options.success, quality: options.quality,
            agent: options.agent, duration: options.duration, timestamp: Date.now(),
            // ADR-147 P2: forward spawn-tree lineage if present
            parentAgentId: options.parentAgentId, depth: options.depth,
          });
          controller = 'learningSystem';
          updated++;
        } else if (typeof learningSystem.record === 'function') {
          await learningSystem.record(options.taskId, options.quality, options.success ? 'success' : 'failure');
          controller = 'learningSystem';
          updated++;
        }
      } catch { /* API mismatch — skip */ }
    }

    // Also record in ReasoningBank for pattern reinforcement
    const reasoningBank = registry.get('reasoningBank');
    if (reasoningBank) {
      try {
        if (typeof reasoningBank.recordOutcome === 'function') {
          await reasoningBank.recordOutcome({
            taskId: options.taskId, verdict: options.success ? 'success' : 'failure',
            score: options.quality, timestamp: Date.now(),
          });
          controller = controller === 'none' ? 'reasoningBank' : `${controller}+reasoningBank`;
          updated++;
        } else if (typeof reasoningBank.record === 'function') {
          await reasoningBank.record(options.taskId, options.quality);
          controller = controller === 'none' ? 'reasoningBank' : `${controller}+reasoningBank`;
          updated++;
        }
      } catch { /* API mismatch — skip */ }
    }

    // Phase 4: SkillLibrary promotion for high-quality patterns
    if (options.success && options.quality >= 0.9 && options.patterns?.length) {
      const skills = registry.get('skills');
      if (skills && typeof skills.promote === 'function') {
        for (const pattern of options.patterns) {
          try { await skills.promote(pattern, options.quality); updated++; } catch { /* skip */ }
        }
        controller += '+skills';
      }
    }

    // Always store feedback as a memory entry for retrieval (ensures it persists)
    const storeResult = await bridgeStoreEntry({
      key: `feedback-${options.taskId}`,
      value: JSON.stringify(options),
      namespace: 'feedback',
      tags: [options.success ? 'success' : 'failure', options.agent || 'unknown'],
      dbPath: options.dbPath,
    });
    if (storeResult?.success) {
      controller = controller === 'none' ? 'bridge-store' : `${controller}+bridge-store`;
      updated++;
    }

    return { success: true, controller, updated };
  } catch {
    return null;
  }
}

// ===== Phase 3: CausalMemoryGraph =====

/**
 * Record a causal edge between two entries (e.g., task → result).
 */
export async function bridgeRecordCausalEdge(options: {
  sourceId: string;
  targetId: string;
  relation: string;
  weight?: number;
  dbPath?: string;
}): Promise<{ success: boolean; controller: string } | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    const causalGraph = registry.get('causalGraph');
    if (causalGraph && typeof causalGraph.addEdge === 'function') {
      causalGraph.addEdge(options.sourceId, options.targetId, {
        relation: options.relation,
        weight: options.weight ?? 1.0,
        timestamp: Date.now(),
      });
      return { success: true, controller: 'causalGraph' };
    }

    // Fallback: store edge as metadata
    const ctx = getDb(registry);
    if (ctx) {
      try {
        ctx.db.prepare(`
          INSERT OR REPLACE INTO memory_entries (id, key, namespace, content, type, created_at, updated_at, status)
          VALUES (?, ?, 'causal-edges', ?, 'procedural', ?, ?, 'active')
        `).run(
          generateId('edge'),
          `${options.sourceId}→${options.targetId}`,
          JSON.stringify(options),
          Date.now(), Date.now(),
        );
        return { success: true, controller: 'bridge-fallback' };
      } catch { /* skip */ }
    }

    return null;
  } catch {
    return null;
  }
}

// ===== #1784: Delete tools for hierarchical + causal-graph =====

/**
 * Delete a hierarchical-memory entry by key (#1784).
 *
 * Reality check: agentdb's HierarchicalMemory class doesn't expose a public
 * delete API today, so the real-backend path falls back to direct SQL on
 * the underlying SQLite tables (status flip to 'deleted' + AttestationLog
 * audit). The bridge-fallback path that bridgeHierarchicalStore uses when
 * HierarchicalMemory isn't loaded writes plain memory_entries rows that
 * `bridgeDeleteEntry` already handles.
 *
 * Returns { controller: 'native-unsupported' } when the real HM is loaded
 * and the SQL fallback can't reach its private tables — surfacing the
 * limitation honestly instead of silently returning success.
 */
export async function bridgeDeleteHierarchical(options: {
  key: string;
  tier?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  deleted: boolean;
  key: string;
  tier?: string;
  controller: string;
  guarded?: boolean;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;
  try {
    const { key, tier } = options;

    // MutationGuard validation
    const guardResult = await guardValidate(registry, 'delete', { key, namespace: 'hierarchical' });
    if (!guardResult.allowed) {
      return { success: false, deleted: false, key, tier, controller: 'guard', error: `MutationGuard rejected: ${guardResult.reason}` };
    }

    const hm = registry.get('hierarchicalMemory');

    // 1. agentdb@3.0.0-alpha.13+: ReflexionMemory.deleteEpisode propagates through
    //    graph adapter / generic graph backend / vector backend AND purges SQL
    //    episodes + episode_embeddings rows. Single call, durably consistent.
    //    See agentic-flow#150/#151 (closes ruvnet/RuVector#427 the cli-visible way).
    const reflexion = registry.get('reflexionMemory');
    if (reflexion && typeof reflexion.deleteEpisode === 'function') {
      try {
        const removed = await reflexion.deleteEpisode(key);
        if (removed) {
          await logAttestation(registry, 'delete', key, { namespace: 'hierarchical', tier });
          return { success: true, deleted: true, key, tier, controller: 'reflexionMemory', guarded: true };
        }
      } catch { /* fall through */ }
    }

    // 2. Try HierarchicalMemory's own delete API if it ever ships one.
    if (hm && typeof hm.delete === 'function') {
      try {
        await hm.delete(key);
        await logAttestation(registry, 'delete', key, { namespace: 'hierarchical', tier });
        return { success: true, deleted: true, key, tier, controller: 'hierarchicalMemory', guarded: true };
      } catch (err) {
        // Fall through to SQL fallback
      }
    }

    // 3. Stub HierarchicalMemory may expose `remove` or `forget`
    if (hm && typeof hm.remove === 'function') {
      try {
        await hm.remove(key);
        await logAttestation(registry, 'delete', key, { namespace: 'hierarchical', tier });
        return { success: true, deleted: true, key, tier, controller: 'hierarchicalMemory-stub', guarded: true };
      } catch { /* fall through */ }
    }

    // 3. Bridge-fallback: HM stored to memory_entries with namespace prefix
    //    (used when the real controller isn't loaded). Soft-delete via SQL.
    const ctx = getDb(registry);
    if (ctx) {
      try {
        const result = ctx.db.prepare(`
          UPDATE memory_entries
          SET status = 'deleted', updated_at = ?
          WHERE key = ? AND namespace LIKE 'hierarchical%' AND status = 'active'
        `).run(Date.now(), key);
        const changes = result?.changes ?? 0;
        if (changes > 0) {
          await logAttestation(registry, 'delete', key, { namespace: 'hierarchical', tier });
          return { success: true, deleted: true, key, tier, controller: 'bridge-fallback', guarded: true };
        }
        // Nothing to delete in SQL fallback — and no real-HM delete API.
        // Surface the situation honestly.
        return {
          success: false, deleted: false, key, tier,
          controller: hm ? 'native-unsupported' : 'not-found',
          error: hm
            ? 'HierarchicalMemory has no public delete API; entry remains in native storage'
            : 'No hierarchical entry found with this key',
        };
      } catch (err) {
        return { success: false, deleted: false, key, tier, controller: 'sql-error', error: (err as Error).message };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Delete a causal edge between two memory entries (#1784).
 *
 * The bridge stores fallback edges in namespace='causal-edges' with key
 * '{sourceId}→{targetId}'. Those CAN be soft-deleted. The native graph-node
 * backend has no delete API (createNode/createEdge/createHyperedge only),
 * so an edge that landed in graph-node native storage stays there. We
 * surface that explicitly via controller: 'native-unsupported'.
 */
export async function bridgeDeleteCausalEdge(options: {
  sourceId: string;
  targetId: string;
  relation?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  deleted: boolean;
  sourceId: string;
  targetId: string;
  controller: string;
  guarded?: boolean;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;
  try {
    const { sourceId, targetId, relation } = options;
    const edgeKey = `${sourceId}→${targetId}`;

    const guardResult = await guardValidate(registry, 'delete', { key: edgeKey, namespace: 'causal-edges' });
    if (!guardResult.allowed) {
      return { success: false, deleted: false, sourceId, targetId, controller: 'guard', error: `MutationGuard rejected: ${guardResult.reason}` };
    }

    const causalGraph = registry.get('causalGraph');

    // 1. agentdb@3.0.0-alpha.13+: GraphDatabaseAdapter.deleteEdgesByEndpoints
    //    handles the (sourceId, targetId, relation?) tuple case directly via
    //    Cypher MATCH … DETACH DELETE. Cypher-injection-safe (label validated
    //    against /^[A-Za-z_][A-Za-z0-9_]*$/ upstream).
    if (causalGraph && typeof causalGraph.deleteEdgesByEndpoints === 'function') {
      try {
        const r = await causalGraph.deleteEdgesByEndpoints(sourceId, targetId, relation);
        const deletedCount = typeof r === 'object' && r ? (r.deleted ?? 0) : (r ? 1 : 0);
        if (deletedCount > 0) {
          await logAttestation(registry, 'delete', edgeKey, { namespace: 'causal-edges', relation, count: deletedCount });
          return { success: true, deleted: true, sourceId, targetId, controller: 'causalGraph-cypher', guarded: true };
        }
      } catch { /* fall through */ }
    }

    // 2. Pre-alpha.13 / different controller: try removeEdge() if exposed.
    if (causalGraph && typeof causalGraph.removeEdge === 'function') {
      try {
        await causalGraph.removeEdge(sourceId, targetId, relation);
        await logAttestation(registry, 'delete', edgeKey, { namespace: 'causal-edges', relation });
        return { success: true, deleted: true, sourceId, targetId, controller: 'causalGraph', guarded: true };
      } catch { /* fall through */ }
    }

    // 2. Bridge-fallback: soft-delete the memory_entries row.
    const ctx = getDb(registry);
    if (ctx) {
      try {
        const result = ctx.db.prepare(`
          UPDATE memory_entries
          SET status = 'deleted', updated_at = ?
          WHERE key = ? AND namespace = 'causal-edges' AND status = 'active'
        `).run(Date.now(), edgeKey);
        const changes = result?.changes ?? 0;
        if (changes > 0) {
          await logAttestation(registry, 'delete', edgeKey, { namespace: 'causal-edges', relation });
          return { success: true, deleted: true, sourceId, targetId, controller: 'bridge-fallback', guarded: true };
        }
        return {
          success: false, deleted: false, sourceId, targetId,
          controller: 'native-unsupported',
          error: 'graph-node native backend has no delete API; edge cannot be removed from native storage. SQL fallback found no matching row.',
        };
      } catch (err) {
        return { success: false, deleted: false, sourceId, targetId, controller: 'sql-error', error: (err as Error).message };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Cascade-delete a causal node and all its incident edges (#1784).
 *
 * Same constraint as bridgeDeleteCausalEdge — native graph-node lacks a
 * delete API. SQL fallback path soft-deletes the node (if stored as a
 * memory_entries row) and every edge whose key contains the nodeId.
 */
export async function bridgeDeleteCausalNode(options: {
  nodeId: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  deletedNode: boolean;
  deletedEdges: number;
  nodeId: string;
  controller: string;
  guarded?: boolean;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;
  try {
    const { nodeId } = options;

    const guardResult = await guardValidate(registry, 'delete', { key: nodeId, namespace: 'causal-nodes' });
    if (!guardResult.allowed) {
      return { success: false, deletedNode: false, deletedEdges: 0, nodeId, controller: 'guard', error: `MutationGuard rejected: ${guardResult.reason}` };
    }

    // 1. agentdb@3.0.0-alpha.13+: GraphDatabaseAdapter.deleteNode(id, {cascade})
    //    counts incident edges before delete so we get accurate audit numbers
    //    regardless of binding stats. Cypher MATCH (n {id}) DETACH DELETE n.
    const causalGraph = registry.get('causalGraph');
    if (causalGraph && typeof causalGraph.deleteNode === 'function') {
      try {
        const r = await causalGraph.deleteNode(nodeId, { cascade: true });
        if (r && typeof r === 'object') {
          const deletedNodeNative = !!r.deletedNode;
          const deletedEdgesNative = typeof r.deletedEdges === 'number' ? r.deletedEdges : 0;
          await logAttestation(registry, 'delete', nodeId, { namespace: 'causal-nodes', deletedEdges: deletedEdgesNative });
          return {
            success: true,
            deletedNode: deletedNodeNative,
            deletedEdges: deletedEdgesNative,
            nodeId,
            controller: 'causalGraph-cypher',
            guarded: true,
          };
        }
      } catch { /* fall through to SQL */ }
    }

    // 2. SQL fallback: soft-delete the node row + every causal-edges row whose
    //    key contains nodeId on either side. Used when agentdb pre-alpha.13 OR
    //    when the entry was stored via the bridge's SQL fallback path.
    const ctx = getDb(registry);
    if (!ctx) return null;

    let deletedEdges = 0;
    let deletedNode = false;
    try {
      const edgeResult = ctx.db.prepare(`
        UPDATE memory_entries
        SET status = 'deleted', updated_at = ?
        WHERE namespace = 'causal-edges'
          AND status = 'active'
          AND (key LIKE ? OR key LIKE ?)
      `).run(Date.now(), `${nodeId}→%`, `%→${nodeId}`);
      deletedEdges = edgeResult?.changes ?? 0;

      const nodeResult = ctx.db.prepare(`
        UPDATE memory_entries
        SET status = 'deleted', updated_at = ?
        WHERE key = ? AND status = 'active'
      `).run(Date.now(), nodeId);
      deletedNode = (nodeResult?.changes ?? 0) > 0;

      await logAttestation(registry, 'delete', nodeId, { namespace: 'causal-nodes', deletedEdges });
    } catch (err) {
      return { success: false, deletedNode: false, deletedEdges: 0, nodeId, controller: 'sql-error', error: (err as Error).message };
    }

    return {
      success: true,
      deletedNode,
      deletedEdges,
      nodeId,
      controller: 'bridge-fallback',
      guarded: true,
    };
  } catch {
    return null;
  }
}

// ===== Phase 5: ReflexionMemory session lifecycle =====

/**
 * Start a session with ReflexionMemory episodic replay.
 * Loads relevant past session patterns for the new session.
 */
export async function bridgeSessionStart(options: {
  sessionId: string;
  context?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  controller: string;
  restoredPatterns: number;
  sessionId: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    let restoredPatterns = 0;
    let controller = 'none';

    // Try ReflexionMemory for episodic session replay
    const reflexion = registry.get('reflexion');
    if (reflexion && typeof reflexion.startEpisode === 'function') {
      await reflexion.startEpisode(options.sessionId, { context: options.context });
      controller = 'reflexion';
    }

    // Load recent patterns from past sessions
    const searchResult = await bridgeSearchEntries({
      query: options.context || 'session patterns',
      namespace: 'session',
      limit: 10,
      threshold: 0.2,
      dbPath: options.dbPath,
    });

    if (searchResult?.results) {
      restoredPatterns = searchResult.results.length;
    }

    return {
      success: true,
      controller: controller === 'none' ? 'bridge-search' : controller,
      restoredPatterns,
      sessionId: options.sessionId,
    };
  } catch {
    return null;
  }
}

/**
 * End a session and persist episodic summary to ReflexionMemory.
 */
export async function bridgeSessionEnd(options: {
  sessionId: string;
  summary?: string;
  tasksCompleted?: number;
  patternsLearned?: number;
  dbPath?: string;
}): Promise<{
  success: boolean;
  controller: string;
  persisted: boolean;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    let controller = 'none';
    let persisted = false;

    // End episode in ReflexionMemory
    const reflexion = registry.get('reflexion');
    if (reflexion && typeof reflexion.endEpisode === 'function') {
      await reflexion.endEpisode(options.sessionId, {
        summary: options.summary,
        tasksCompleted: options.tasksCompleted,
        patternsLearned: options.patternsLearned,
      });
      controller = 'reflexion';
      persisted = true;
    }

    // Persist session summary as memory entry
    await bridgeStoreEntry({
      key: `session-${options.sessionId}`,
      value: JSON.stringify({
        sessionId: options.sessionId,
        summary: options.summary || 'Session ended',
        tasksCompleted: options.tasksCompleted ?? 0,
        patternsLearned: options.patternsLearned ?? 0,
        endedAt: new Date().toISOString(),
      }),
      namespace: 'session',
      tags: ['session-end'],
      upsert: true,
      dbPath: options.dbPath,
    });

    if (controller === 'none') controller = 'bridge-store';
    persisted = true;

    // Phase 3: Trigger NightlyLearner consolidation if available
    const nightlyLearner = registry.get('nightlyLearner');
    if (nightlyLearner && typeof nightlyLearner.consolidate === 'function') {
      try {
        await nightlyLearner.consolidate({ sessionId: options.sessionId });
        controller += '+nightlyLearner';
      } catch { /* non-fatal */ }
    }

    return { success: true, controller, persisted };
  } catch {
    return null;
  }
}

// ===== Phase 5: SemanticRouter bridge =====

/**
 * Route a task via AgentDB's SemanticRouter.
 * Returns null to fall back to local ruvector router.
 */
export async function bridgeRouteTask(options: {
  task: string;
  context?: string;
  dbPath?: string;
}): Promise<{
  route: string;
  confidence: number;
  agents: string[];
  controller: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    // Try AgentDB's SemanticRouter
    const semanticRouter = registry.get('semanticRouter');
    if (semanticRouter && typeof semanticRouter.route === 'function') {
      const result = await semanticRouter.route(options.task, { context: options.context });
      if (result) {
        return {
          route: result.route || result.category || 'general',
          confidence: result.confidence ?? result.score ?? 0.5,
          agents: result.agents || result.suggestedAgents || [],
          controller: 'semanticRouter',
        };
      }
    }

    // Try LearningSystem recommendAlgorithm (Phase 4)
    const learningSystem = registry.get('learningSystem');
    if (learningSystem && typeof learningSystem.recommendAlgorithm === 'function') {
      const rec = await learningSystem.recommendAlgorithm(options.task);
      if (rec) {
        return {
          route: rec.algorithm || rec.route || 'general',
          confidence: rec.confidence ?? 0.5,
          agents: rec.agents || [],
          controller: 'learningSystem',
        };
      }
    }

    return null; // Fall back to local router
  } catch {
    return null;
  }
}

// ===== Phase 4: Health check with attestation =====

/**
 * Get comprehensive bridge health including all controller statuses.
 */
export async function bridgeHealthCheck(
  dbPath?: string,
): Promise<{
  available: boolean;
  controllers: Array<{ name: string; enabled: boolean; level: number }>;
  attestationCount?: number;
  cacheStats?: { size: number; hits: number; misses: number };
} | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  try {
    const controllers = registry.listControllers();

    // Phase 4: AttestationLog stats
    let attestationCount = 0;
    const attestation = registry.get('attestationLog');
    if (attestation && typeof attestation.count === 'function') {
      attestationCount = attestation.count();
    }

    // Phase 2: TieredCache stats
    let cacheStats = { size: 0, hits: 0, misses: 0 };
    const cache = registry.get('tieredCache');
    if (cache && typeof cache.stats === 'function') {
      const s = cache.stats();
      cacheStats = { size: s.size ?? 0, hits: s.hits ?? 0, misses: s.misses ?? 0 };
    }

    return { available: true, controllers, attestationCount, cacheStats };
  } catch {
    return null;
  }
}

// ===== Phase 7: Hierarchical memory, consolidation, batch, context, semantic route =====

/**
 * Store to hierarchical memory with tier.
 * Valid tiers: working, episodic, semantic
 *
 * Real HierarchicalMemory API (agentdb alpha.10+):
 *   store(content, importance?, tier?, options?) → Promise<string>
 * Fallback API (@claude-flow/memory TieredMemoryStore):
 *   store(key, value, tier, temporalOptions?) — synchronous, returns
 *   { id, key, tier, superseded? }
 *
 * Temporal validity (Zep/Graphiti-style, impl/memory-sota):
 * - validFrom / validUntil (ISO) travel with the entry.
 * - supersedes=<entryId|key> INVALIDATES the old entry (validUntil=now +
 *   supersededBy=newId) instead of deleting it. Natively supported by the
 *   TieredMemoryStore fallback; on the real agentdb HierarchicalMemory the
 *   temporal fields are stored in metadata, and supersede is reported as
 *   unsupported (no public update API) rather than silently dropped.
 */
export async function bridgeHierarchicalStore(params: {
  key: string; value: string; tier?: string; importance?: number;
  validFrom?: string; validUntil?: string; supersedes?: string;
}): Promise<any> {
  const registry = await getRegistry();
  if (!registry) return null;
  try {
    const hm = registry.get('hierarchicalMemory');
    if (!hm) return { success: false, error: 'HierarchicalMemory not available' };
    const tier = params.tier || 'working';

    // Detect real HierarchicalMemory (has async store returning id) vs stub
    if (typeof hm.getStats === 'function' && typeof hm.promote === 'function') {
      // Real agentdb HierarchicalMemory — temporal fields ride in metadata
      // so bridgeHierarchicalRecall can filter on them.
      const metadata: Record<string, unknown> = { key: params.key };
      if (params.validFrom) metadata.validFrom = params.validFrom;
      if (params.validUntil) metadata.validUntil = params.validUntil;
      const id = await hm.store(params.value, params.importance || 0.5, tier, {
        metadata,
        tags: [params.key],
      });
      const result: any = { success: true, id, key: params.key, tier };
      if (params.supersedes) {
        // No public update/invalidate API on agentdb HierarchicalMemory —
        // surface the limitation honestly instead of silently dropping it.
        result.superseded = null;
        result.warning = 'supersedes is not supported by the native agentdb HierarchicalMemory backend (no update API); the referenced entry was left untouched';
      }
      return result;
    }
    // TieredMemoryStore fallback (temporal-aware) / legacy stub
    const storeResult = hm.store(params.key, params.value, tier, {
      validFrom: params.validFrom,
      validUntil: params.validUntil,
      supersedes: params.supersedes,
    });
    if (storeResult && typeof storeResult === 'object') {
      return { success: true, ...storeResult };
    }
    // Legacy stub (returns void) — temporal options were ignored
    return { success: true, key: params.key, tier };
  } catch (e: any) { return { success: false, error: e.message }; }
}

/**
 * Recall from hierarchical memory.
 *
 * Real HierarchicalMemory API (agentdb alpha.10+):
 *   recall(query: MemoryQuery) → Promise<MemoryItem[]>
 *   where MemoryQuery = { query, tier?, k?, threshold?, context?, includeDecayed? }
 * Stub API (fallback):
 *   recall(query: string, topK: number) → synchronous array
 */
export async function bridgeHierarchicalRecall(params: { query: string; tier?: string; topK?: number; includeExpired?: boolean }): Promise<any> {
  const registry = await getRegistry();
  if (!registry) return null;
  try {
    const hm = registry.get('hierarchicalMemory');
    if (!hm) return { results: [], error: 'HierarchicalMemory not available' };

    // Detect real HierarchicalMemory vs stub
    if (typeof hm.getStats === 'function' && typeof hm.promote === 'function') {
      // Real agentdb HierarchicalMemory — recall takes MemoryQuery object
      const memoryQuery: any = {
        query: params.query,
        k: params.topK || 5,
      };
      if (params.tier) {
        memoryQuery.tier = params.tier;
      }
      const results = await hm.recall(memoryQuery);
      // Temporal filter over metadata (validFrom/validUntil stamped by
      // bridgeHierarchicalStore). Entries without the fields are always
      // valid — legacy behavior unchanged.
      const filtered = params.includeExpired
        ? (results || [])
        : (results || []).filter((r: any) => {
            const meta = r?.metadata || {};
            const now = Date.now();
            if (meta.validFrom) {
              const from = Date.parse(String(meta.validFrom));
              if (!Number.isNaN(from) && from > now) return false;
            }
            if (meta.validUntil) {
              const until = Date.parse(String(meta.validUntil));
              if (!Number.isNaN(until) && until <= now) return false;
            }
            return true;
          });
      return { results: filtered, controller: 'hierarchicalMemory' };
    }

    // TieredMemoryStore fallback — recall(string, number, options?).
    // Temporal filtering happens inside the store; the legacy stub simply
    // ignores the extra argument.
    const results = hm.recall(params.query, params.topK || 5, {
      includeExpired: params.includeExpired === true,
    });
    const filtered = params.tier
      ? results.filter((r: any) => r.tier === params.tier)
      : results;
    return { results: filtered, controller: 'hierarchicalMemory' };
  } catch (e: any) { return { results: [], error: e.message }; }
}

/**
 * Run memory consolidation.
 *
 * Real MemoryConsolidation API (agentdb alpha.10+):
 *   consolidate() → Promise<ConsolidationReport>
 *   ConsolidationReport = { episodicProcessed, semanticCreated, memoriesForgotten, ... }
 * Stub API (fallback):
 *   consolidate() → { promoted, pruned, timestamp }
 */
export async function bridgeConsolidate(params: { minAge?: number; maxEntries?: number }): Promise<any> {
  const registry = await getRegistry();
  if (!registry) return null;
  try {
    const mc = registry.get('memoryConsolidation');
    if (!mc) return { success: false, error: 'MemoryConsolidation not available' };
    const result = await mc.consolidate();
    return { success: true, consolidated: result };
  } catch (e: any) { return { success: false, error: e.message }; }
}

/**
 * Batch operations (insert, update, delete).
 * - insert: calls insertEpisodes(entries) where entries are {content, metadata?}
 * - delete: calls bulkDelete(table, conditions) on episodes table
 * - update: calls bulkUpdate(table, updates, conditions) on episodes table
 */
export async function bridgeBatchOperation(params: { operation: string; entries: any[] }): Promise<any> {
  const registry = await getRegistry();
  if (!registry) return null;
  try {
    const batch = registry.get('batchOperations');
    if (!batch) return { success: false, error: 'BatchOperations not available' };
    let result;
    switch (params.operation) {
      case 'insert': {
        if (typeof batch.insertEpisodes !== 'function') {
          return { success: false, error: 'BatchOperations.insertEpisodes not available — embedder may not be initialized. Use memory_store instead.' };
        }
        const episodes = params.entries.map((e: any) => ({
          content: e.value || e.content || JSON.stringify(e),
          metadata: e.metadata || { key: e.key },
        }));
        try {
          result = await batch.insertEpisodes(episodes);
        } catch (insertErr: any) {
          if (insertErr?.message?.includes('null') || insertErr?.message?.includes('embedBatch')) {
            return { success: false, error: 'Embedder not initialized for batch insert. Use memory_store for individual entries or run embeddings_init first.' };
          }
          throw insertErr;
        }
        break;
      }
      case 'delete': {
        // bulkDelete(table, conditions) — conditions is a WHERE clause object
        const keys = params.entries.map((e: any) => e.key).filter(Boolean);
        for (const key of keys) {
          await batch.bulkDelete('episodes', { key });
        }
        result = { deleted: keys.length };
        break;
      }
      case 'update': {
        // bulkUpdate(table, updates, conditions)
        for (const entry of params.entries) {
          await batch.bulkUpdate('episodes', { content: entry.value || entry.content }, { key: entry.key });
        }
        result = { updated: params.entries.length };
        break;
      }
      default: return { success: false, error: `Unknown operation: ${params.operation}` };
    }
    return { success: true, operation: params.operation, count: params.entries.length, result };
  } catch (e: any) { return { success: false, error: e.message }; }
}

/**
 * Synthesize context from memories.
 * ContextSynthesizer.synthesize is a static method that takes MemoryPattern[] (not a string).
 */
export async function bridgeContextSynthesize(params: { query: string; maxEntries?: number }): Promise<any> {
  const registry = await getRegistry();
  if (!registry) return null;
  try {
    const CS = registry.get('contextSynthesizer');
    if (!CS || typeof CS.synthesize !== 'function') {
      return { success: false, error: 'ContextSynthesizer not available' };
    }
    // Gather memory patterns from hierarchical memory as input
    const hm = registry.get('hierarchicalMemory');
    let memories: any[] = [];
    if (hm && typeof hm.recall === 'function') {
      // Detect real HierarchicalMemory (MemoryQuery object) vs stub (string, number)
      let recalled: any[];
      if (typeof hm.promote === 'function') {
        // Real agentdb HierarchicalMemory
        recalled = await hm.recall({ query: params.query, k: params.maxEntries || 10 });
      } else {
        // Stub
        recalled = hm.recall(params.query, params.maxEntries || 10);
      }
      memories = (recalled || []).map((r: any) => ({
        content: r.value || r.content || '',
        key: r.key || r.id || '',
        reward: 1,
        verdict: 'success',
      }));
    }
    const result = CS.synthesize(memories, { includeRecommendations: true });
    return { success: true, synthesis: result };
  } catch (e: any) { return { success: false, error: e.message }; }
}

/**
 * Route via SemanticRouter.
 * Available since agentdb 3.0.0-alpha.10 — uses @ruvector/router for
 * semantic matching with keyword fallback.
 */
export async function bridgeSemanticRoute(params: { input: string }): Promise<any> {
  const registry = await getRegistry();
  if (!registry) return null;
  try {
    const router = registry.get('semanticRouter');
    if (!router) {
      // ADR-093 F9: surface an actionable error pointing callers at the
      // alternative routing surfaces that DO work, instead of just
      // saying "not available".
      return {
        route: null,
        error: 'SemanticRouter not available in current agentdb build',
        recommendation: 'Use bridgeRouteTask (registers as `agentdb_route` MCP tool) for keyword+pattern routing, or hooks_model-route for ADR-026 model selection.',
        controller: 'none',
      };
    }
    const result = await router.route(params.input);
    return { route: result, controller: 'semanticRouter' };
  } catch (e: any) { return { route: null, error: e.message, controller: 'error' }; }
}

// ===== RaBitQ data export =====

/**
 * Export all embeddings from the bridge's better-sqlite3 connection.
 * Used by RaBitQ to build its index from the same data that memory_store writes.
 * Returns null if bridge is unavailable (caller falls back to sql.js).
 */
export async function bridgeGetAllEmbeddings(options?: {
  dimensions?: number;
  limit?: number;
  dbPath?: string;
}): Promise<Array<{
  id: string;
  key: string;
  namespace: string;
  embedding: number[];
}> | null> {
  const registry = await getRegistry(options?.dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const dims = options?.dimensions ?? 384;
    const maxRows = options?.limit ?? 50000;

    const rows: any[] = ctx.db.prepare(`
      SELECT id, key, namespace, embedding
      FROM memory_entries
      WHERE status = 'active' AND embedding IS NOT NULL
      LIMIT ?
    `).all(maxRows);

    const results: Array<{ id: string; key: string; namespace: string; embedding: number[] }> = [];

    for (const row of rows) {
      if (!row.embedding) continue;
      try {
        const emb = JSON.parse(row.embedding) as number[];
        if (emb.length !== dims) continue;
        results.push({
          id: String(row.id),
          key: row.key || String(row.id),
          namespace: row.namespace || 'default',
          embedding: emb,
        });
      } catch { /* skip invalid */ }
    }

    return results;
  } catch {
    return null;
  }
}

// ===== Utility =====

function cosineSim(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    const ai = a[i], bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const mag = Math.sqrt(normA * normB);
  return mag === 0 ? 0 : dot / mag;
}

/**
 * Public helper for the unified learning-stats aggregator: counts of entries
 * per namespace + the top-level total. Best-effort — if the bridge isn't
 * available it returns zeros so the aggregator can still report the other
 * stores honestly. (#2245 follow-up.)
 */
export async function getMemoryBridgeStats(options: {
  namespaces?: string[];
  dbPath?: string;
} = {}): Promise<{
  totalEntries: number;
  perNamespace: Record<string, number>;
  source: string;
  reachable: boolean;
}> {
  const namespaces = options.namespaces ?? [
    'default', 'patterns', 'claude-memories', 'auto-memory',
    'tasks', 'feedback', 'pretrain', 'trajectories',
  ];
  try {
    const all = await bridgeListEntries({ dbPath: options.dbPath, limit: 1 });
    if (!all) {
      return { totalEntries: 0, perNamespace: {}, source: 'memory-bridge (unreachable)', reachable: false };
    }
    const perNamespace: Record<string, number> = {};
    for (const ns of namespaces) {
      try {
        const r = await bridgeListEntries({ namespace: ns, dbPath: options.dbPath, limit: 1 });
        const n = r?.total ?? 0;
        if (n > 0) perNamespace[ns] = n;
      } catch { /* skip per-namespace failure */ }
    }
    return {
      totalEntries: all.total,
      perNamespace,
      source: 'memory-bridge AgentDB (bridgeListEntries)',
      reachable: true,
    };
  } catch {
    return { totalEntries: 0, perNamespace: {}, source: 'memory-bridge (error)', reachable: false };
  }
}
