/**
 * Structural validation for a decoded SONAManager snapshot.
 *
 * SONAManager.deserialize() used to assign every field without checking it, so a
 * schema-valid but malformed file (truncated, hand-edited, or planted in a
 * repository's `.swarm/` directory) left the manager half-applied with
 * undefined containers. This runs BEFORE any field is assigned.
 *
 * Kept free of imports from the mode implementations so it can be unit-tested
 * without the mode/manager load-order cycle.
 */

const SONA_MODES: readonly string[] = ['real-time', 'balanced', 'research', 'edge', 'batch'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Throws a descriptive Error unless `decoded` is a complete, well-typed schemaVersion 1 snapshot. */
export function assertValidSonaSnapshot(decoded: unknown): void {
  if (!isRecord(decoded)) {
    throw new Error('SONAManager: state must be an object');
  }
  if (decoded.schemaVersion !== 1) {
    throw new Error(`SONAManager: unsupported schemaVersion ${String(decoded.schemaVersion)} (expected 1)`);
  }
  if (typeof decoded.currentMode !== 'string' || !SONA_MODES.includes(decoded.currentMode)) {
    throw new Error(`SONAManager: invalid currentMode ${String(decoded.currentMode)}`);
  }
  if (!isRecord(decoded.config) || !isRecord(decoded.optimizations) || !isRecord(decoded.stats)) {
    throw new Error('SONAManager: invalid config, optimizations or stats');
  }
  if (
    !(decoded.trajectories instanceof Map) ||
    !(decoded.patterns instanceof Map) ||
    !(decoded.loraWeights instanceof Map)
  ) {
    throw new Error('SONAManager: trajectories, patterns and loraWeights must be maps');
  }
  if (decoded.ewcState !== null && !isRecord(decoded.ewcState)) {
    throw new Error('SONAManager: invalid ewcState');
  }
  if (typeof decoded.isInitialized !== 'boolean') {
    throw new Error('SONAManager: invalid isInitialized');
  }
  for (const key of ['operationCount', 'totalLatencyMs', 'learningCycles', 'lastStatsUpdate']) {
    const v = decoded[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`SONAManager: invalid ${key}`);
    }
  }
}
