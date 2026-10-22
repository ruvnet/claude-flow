import { describe, expect, it } from 'vitest';
import {
  GCNLayer,
  GraphOperations,
  GNNSQLGenerator,
} from '../src/integrations/ruvector/gnn.js';

// The *SQL() methods below are executed verbatim by a caller's query executor.
// TypeScript types do not exist at runtime, so any identifier (schema/table/
// column) or value (node id, algorithm name, ...) interpolated into the
// returned string must be validated. Before hardening, an identifier
// containing `"` or a value containing `'` could break out of the query.

describe('GNN toSQL/*SQL injection hardening', () => {
  describe('BaseGNNLayer#toSQL', () => {
    it('emits unchanged SQL for legitimate input', () => {
      const layer = new GCNLayer({ type: 'gcn', inputDim: 4, outputDim: 2 });
      const sql = layer.toSQL('nodes', { schema: 'app', edgeTable: 'edges', nodeColumn: 'vec' });
      expect(sql).toContain('FROM "app"."nodes"'.replace(/"/g, '"'));
      expect(sql).toContain('SELECT ruvector.gcn_layer(');
      expect(sql).toContain('array_agg("vec")');
      expect(sql).toContain('FROM "app"."edges"');
    });

    it('emits a $N placeholder for prepared statements with the default prefix', () => {
      const layer = new GCNLayer({ type: 'gcn', inputDim: 4, outputDim: 2 });
      const sql = layer.toSQL('nodes', { prepared: true });
      expect(sql).toContain('$1::jsonb');
    });

    it.each([
      ['schema', { schema: '"; DROP TABLE t; --' }],
      ['nodeColumn', { nodeColumn: 'x") ; DROP TABLE t; --' }],
      ['edgeTable', { edgeTable: 'x"."y' }],
    ])('rejects a malicious %s identifier', (_name, options) => {
      const layer = new GCNLayer({ type: 'gcn', inputDim: 4, outputDim: 2 });
      expect(() => layer.toSQL('nodes', options)).toThrow(TypeError);
    });

    it('rejects a malicious tableName identifier', () => {
      const layer = new GCNLayer({ type: 'gcn', inputDim: 4, outputDim: 2 });
      expect(() => layer.toSQL('nodes"; DROP TABLE t; --')).toThrow(TypeError);
    });

    it('rejects a malicious paramPrefix', () => {
      const layer = new GCNLayer({ type: 'gcn', inputDim: 4, outputDim: 2 });
      expect(() =>
        layer.toSQL('nodes', { prepared: true, paramPrefix: "'; DROP TABLE t; --" })
      ).toThrow(TypeError);
    });

    it('embeds config values that contain a single quote safely', () => {
      const layer = new GCNLayer({
        type: 'gcn',
        inputDim: 4,
        outputDim: 2,
        params: { note: "'; DROP TABLE t; --" },
      });
      const sql = layer.toSQL('nodes');
      // The quote must be doubled inside the jsonb literal, not break out of it.
      expect(sql).toContain("''; DROP TABLE t; --");
      expect(sql.match(/::jsonb/g)?.length).toBe(1);
    });
  });

  describe('GraphOperations SQL builders', () => {
    const ops = new GraphOperations();

    it('emits unchanged SQL for legitimate input', () => {
      const sql = ops.kHopNeighborsSQL('n1', 2, 'nodes', { schema: 'app', edgeTable: 'edges' });
      expect(sql).toContain("target_id = 'n1'");
      expect(sql).toContain('kh.depth < 2');
      expect(sql).toContain('FROM "app"."edges"');
    });

    it('escapes a single quote in nodeId as a literal, not a break-out', () => {
      const sql = ops.kHopNeighborsSQL("1' OR '1'='1", 2, 'nodes');
      expect(sql).toContain("'1'' OR ''1''=''1'");
    });

    it.each([
      ['schema', () => ops.kHopNeighborsSQL('n1', 2, 'nodes', { schema: 'a"; DROP TABLE t; --' })],
      ['edgeTable', () => ops.kHopNeighborsSQL('n1', 2, 'nodes', { edgeTable: 'e"; DROP TABLE t; --' })],
      ['k', () => ops.kHopNeighborsSQL('n1', Number.NaN, 'nodes')],
      ['k (non-integer)', () => ops.kHopNeighborsSQL('n1', 1.5, 'nodes')],
      ['nodeId (non-string)', () => ops.kHopNeighborsSQL(123 as never, 2, 'nodes')],
    ])('rejects a malicious/invalid %s', (_name, run) => {
      expect(run).toThrow(TypeError);
    });

    it('shortestPathSQL escapes source/target literals', () => {
      const sql = ops.shortestPathSQL("a' OR '1'='1", 'b', 'nodes');
      expect(sql).toContain("'a'' OR ''1''=''1'");
    });

    it('shortestPathSQL rejects a malicious edgeTable identifier', () => {
      expect(() =>
        ops.shortestPathSQL('a', 'b', 'nodes', { edgeTable: 'e"."other' })
      ).toThrow(TypeError);
    });

    it('pageRankSQL rejects non-finite damping/maxIterations', () => {
      expect(() => ops.pageRankSQL('nodes', { damping: Number.POSITIVE_INFINITY })).toThrow(TypeError);
      expect(() => ops.pageRankSQL('nodes', { maxIterations: 1.5 })).toThrow(TypeError);
    });

    it('communityDetectionSQL escapes the algorithm literal', () => {
      const sql = ops.communityDetectionSQL('nodes', {
        algorithm: "louvain'; DROP TABLE t; --" as never,
      });
      expect(sql).toContain("'louvain''; DROP TABLE t; --'");
    });

    it('communityDetectionSQL rejects a non-finite resolution', () => {
      expect(() =>
        ops.communityDetectionSQL('nodes', { algorithm: 'louvain', resolution: Number.NaN })
      ).toThrow(TypeError);
    });
  });

  describe('GNNSQLGenerator static SQL builders', () => {
    it('cacheEmbeddingsSQL/createCacheTableSQL reject malicious identifiers', () => {
      expect(() =>
        GNNSQLGenerator.cacheEmbeddingsSQL('nodes', 'cache"; DROP TABLE t; --')
      ).toThrow(TypeError);
      expect(() =>
        GNNSQLGenerator.createCacheTableSQL('cache"; DROP TABLE t; --', 128)
      ).toThrow(TypeError);
    });

    it('createCacheTableSQL rejects a non-positive dimension', () => {
      expect(() => GNNSQLGenerator.createCacheTableSQL('cache', 0)).toThrow(TypeError);
      expect(() => GNNSQLGenerator.createCacheTableSQL('cache', 1.5)).toThrow(TypeError);
    });

    it('createCacheTableSQL emits unchanged SQL for legitimate input', () => {
      const sql = GNNSQLGenerator.createCacheTableSQL('cache', 128, { schema: 'app' });
      expect(sql).toContain('embedding vector(128) NOT NULL');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "app"."cache"');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS "cache_computed_at_idx"');
    });

    it('messagePassingSQL/graphPoolingSQL reject malicious identifiers', () => {
      expect(() =>
        GNNSQLGenerator.messagePassingSQL('nodes"; DROP TABLE t; --', 'mean')
      ).toThrow(TypeError);
      expect(() =>
        GNNSQLGenerator.graphPoolingSQL('nodes', 'mean', { nodeColumn: 'x") --' })
      ).toThrow(TypeError);
    });

    it('batchGNNSQL rejects a malicious tableName', () => {
      const layer = new GCNLayer({ type: 'gcn', inputDim: 4, outputDim: 2 });
      expect(() =>
        GNNSQLGenerator.batchGNNSQL([layer], 'nodes"; DROP TABLE t; --')
      ).toThrow(TypeError);
    });
  });
});
