/**
 * Hyperbolic Embeddings Bridge
 *
 * Bridge to ruvector-hyperbolic-hnsw-wasm for hierarchical data representation
 * using Poincaré ball model, Lorentz model, or Klein model.
 */

import type { WasmBridge, WasmModuleStatus, HyperbolicConfig } from '../types.js';
import { HyperbolicConfigSchema } from '../types.js';

/**
 * Hyperbolic point
 */
export interface HyperbolicPoint {
  coordinates: Float32Array;
  curvature: number;
}

/**
 * Hyperbolic WASM module interface
 */
interface HyperbolicModule {
  // Embedding operations
  embed(vector: Float32Array, config: HyperbolicConfig): HyperbolicPoint;
  project(point: HyperbolicPoint): Float32Array;

  // Distance and similarity
  distance(a: HyperbolicPoint, b: HyperbolicPoint): number;
  similarity(a: HyperbolicPoint, b: HyperbolicPoint): number;

  // Geometric operations
  midpoint(a: HyperbolicPoint, b: HyperbolicPoint): HyperbolicPoint;
  geodesic(a: HyperbolicPoint, b: HyperbolicPoint, steps: number): HyperbolicPoint[];

  // Hierarchy operations
  isAncestor(parent: HyperbolicPoint, child: HyperbolicPoint, threshold: number): boolean;
  hierarchyDepth(point: HyperbolicPoint): number;

  // HNSW search in hyperbolic space
  addToIndex(id: string, point: HyperbolicPoint): void;
  search(query: HyperbolicPoint, k: number): Array<{ id: string; distance: number }>;
}

/**
 * Hyperbolic Embeddings Bridge implementation
 */
export class HyperbolicBridge implements WasmBridge<HyperbolicModule> {
  readonly name = 'ruvector-hyperbolic-hnsw-wasm';
  readonly version = '0.1.0';

  private _status: WasmModuleStatus = 'unloaded';
  private _module: HyperbolicModule | null = null;
  private config: HyperbolicConfig;

  constructor(config?: Partial<HyperbolicConfig>) {
    this.config = HyperbolicConfigSchema.parse(config ?? {});
  }

  get status(): WasmModuleStatus {
    return this._status;
  }

  async init(): Promise<void> {
    if (this._status === 'ready') return;
    if (this._status === 'loading') return;

    this._status = 'loading';

    try {
      const wasmModule = await import('@ruvector/hyperbolic-hnsw-wasm' as string).catch(() => null);

      if (wasmModule) {
        this._module = wasmModule as unknown as HyperbolicModule;
      } else {
        this._module = this.createMockModule();
      }

      this._status = 'ready';
    } catch (error) {
      this._status = 'error';
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this._module = null;
    this._status = 'unloaded';
  }

  isReady(): boolean {
    return this._status === 'ready';
  }

  getModule(): HyperbolicModule | null {
    return this._module;
  }

  /**
   * Embed a vector into hyperbolic space
   */
  embed(vector: Float32Array, config?: Partial<HyperbolicConfig>): HyperbolicPoint {
    if (!this._module) throw new Error('Hyperbolic module not initialized');
    const mergedConfig = { ...this.config, ...config };
    return this._module.embed(vector, mergedConfig);
  }

  /**
   * Project hyperbolic point to Euclidean space
   */
  project(point: HyperbolicPoint): Float32Array {
    if (!this._module) throw new Error('Hyperbolic module not initialized');
    return this._module.project(point);
  }

  /**
   * Compute hyperbolic distance
   */
  distance(a: HyperbolicPoint, b: HyperbolicPoint): number {
    if (!this._module) throw new Error('Hyperbolic module not initialized');
    return this._module.distance(a, b);
  }

  /**
   * Compute hyperbolic similarity
   */
  similarity(a: HyperbolicPoint, b: HyperbolicPoint): number {
    if (!this._module) throw new Error('Hyperbolic module not initialized');
    return this._module.similarity(a, b);
  }

  /**
   * Check if one point is ancestor of another (hierarchy)
   */
  isAncestor(parent: HyperbolicPoint, child: HyperbolicPoint, threshold = 0.1): boolean {
    if (!this._module) throw new Error('Hyperbolic module not initialized');
    return this._module.isAncestor(parent, child, threshold);
  }

  /**
   * Get hierarchy depth of a point
   */
  hierarchyDepth(point: HyperbolicPoint): number {
    if (!this._module) throw new Error('Hyperbolic module not initialized');
    return this._module.hierarchyDepth(point);
  }

  /**
   * Add point to HNSW index
   */
  addToIndex(id: string, point: HyperbolicPoint): void {
    if (!this._module) throw new Error('Hyperbolic module not initialized');
    this._module.addToIndex(id, point);
  }

  /**
   * Search in hyperbolic HNSW index
   */
  search(query: HyperbolicPoint, k: number): Array<{ id: string; distance: number }> {
    if (!this._module) throw new Error('Hyperbolic module not initialized');
    return this._module.search(query, k);
  }

  /**
   * Create mock module for development
   */
  private createMockModule(): HyperbolicModule {
    const index = new Map<string, HyperbolicPoint>();

    return {
      embed(vector: Float32Array, config: HyperbolicConfig): HyperbolicPoint {
        // Map to Poincaré ball (simplified)
        const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
        const scale = Math.tanh(norm) / (norm || 1);
        const coords = new Float32Array(config.dimensions);

        for (let i = 0; i < config.dimensions; i++) {
          coords[i] = (vector[i % vector.length] || 0) * scale * 0.9;
        }

        return { coordinates: coords, curvature: config.curvature };
      },

      project(point: HyperbolicPoint): Float32Array {
        // Inverse of embedding
        const coords = point.coordinates;
        const norm = Math.sqrt(coords.reduce((s, v) => s + v * v, 0));
        const scale = Math.atanh(Math.min(norm, 0.99)) / (norm || 1);

        const result = new Float32Array(coords.length);
        for (let i = 0; i < coords.length; i++) {
          result[i] = coords[i] * scale;
        }
        return result;
      },

      distance(a: HyperbolicPoint, b: HyperbolicPoint): number {
        // Poincaré distance approximation
        const c = Math.abs(a.curvature);
        const diffSq = a.coordinates.reduce((s, v, i) => s + Math.pow(v - b.coordinates[i], 2), 0);
        const normA = a.coordinates.reduce((s, v) => s + v * v, 0);
        const normB = b.coordinates.reduce((s, v) => s + v * v, 0);

        const delta = 2 * diffSq / ((1 - normA) * (1 - normB));
        return (1 / Math.sqrt(c)) * Math.acosh(1 + delta);
      },

      similarity(a: HyperbolicPoint, b: HyperbolicPoint): number {
        const dist = this.distance(a, b);
        return Math.exp(-dist);
      },

      midpoint(a: HyperbolicPoint, b: HyperbolicPoint): HyperbolicPoint {
        const mid = new Float32Array(a.coordinates.length);
        for (let i = 0; i < mid.length; i++) {
          mid[i] = (a.coordinates[i] + b.coordinates[i]) / 2;
        }
        return { coordinates: mid, curvature: a.curvature };
      },

      geodesic(a: HyperbolicPoint, b: HyperbolicPoint, steps: number): HyperbolicPoint[] {
        const result: HyperbolicPoint[] = [];
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const coords = new Float32Array(a.coordinates.length);
          for (let j = 0; j < coords.length; j++) {
            coords[j] = a.coordinates[j] * (1 - t) + b.coordinates[j] * t;
          }
          result.push({ coordinates: coords, curvature: a.curvature });
        }
        return result;
      },

      isAncestor(parent: HyperbolicPoint, child: HyperbolicPoint, threshold: number): boolean {
        const parentNorm = Math.sqrt(parent.coordinates.reduce((s, v) => s + v * v, 0));
        const childNorm = Math.sqrt(child.coordinates.reduce((s, v) => s + v * v, 0));
        return parentNorm < childNorm - threshold;
      },

      hierarchyDepth(point: HyperbolicPoint): number {
        const norm = Math.sqrt(point.coordinates.reduce((s, v) => s + v * v, 0));
        return Math.atanh(Math.min(norm, 0.99));
      },

      addToIndex(id: string, point: HyperbolicPoint): void {
        index.set(id, point);
      },

      search(query: HyperbolicPoint, k: number): Array<{ id: string; distance: number }> {
        const results: Array<{ id: string; distance: number }> = [];

        for (const [id, point] of index) {
          const distance = this.distance(query, point);
          results.push({ id, distance });
        }

        results.sort((a, b) => a.distance - b.distance);
        return results.slice(0, k);
      },
    };
  }
}

/**
 * Create a new hyperbolic bridge
 */
export function createHyperbolicBridge(config?: Partial<HyperbolicConfig>): HyperbolicBridge {
  return new HyperbolicBridge(config);
}
