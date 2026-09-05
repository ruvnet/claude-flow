/**
 * WASM Bridge - Prime Radiant Plugin
 *
 * Main WASM bridge for loading and managing the prime-radiant-advanced-wasm
 * module. Handles initialization for both Node.js and browser environments.
 *
 * Bundle size: ~92KB (zero dependencies)
 * Load time target: <50ms
 */

import type {
  WasmModule,
  WasmBridgeConfig,
  WasmStatus,
  ICohomologyEngine,
  ISpectralEngine,
  ICausalEngine,
  IQuantumEngine,
  ICategoryEngine,
  IHottEngine
} from './types.js';

import {
  CohomologyEngine,
  SpectralEngine,
  CausalEngine,
  QuantumEngine,
  CategoryEngine,
  HottEngine
} from './engines/index.js';

/**
 * Default WASM file path
 */
const DEFAULT_WASM_PATH = 'prime-radiant-advanced-wasm/prime_radiant_bg.wasm';

/**
 * Environment detection
 */
const isNode = typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalWindow = typeof globalThis !== 'undefined' ? (globalThis as any).window : undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalSelf = typeof globalThis !== 'undefined' ? (globalThis as any).self : undefined;

const isBrowser = typeof globalWindow !== 'undefined' &&
  typeof globalWindow.document !== 'undefined';

const isWebWorker = typeof globalSelf === 'object' &&
  globalSelf?.constructor &&
  globalSelf.constructor.name === 'DedicatedWorkerGlobalScope';

/**
 * WasmBridge - Main WASM bridge for Prime Radiant plugin
 *
 * Manages WASM module lifecycle and provides access to mathematical engines.
 */
export class WasmBridge {
  private wasmModule: WasmModule | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private loadTime = 0;
  private bundleSize = 0;

  // Engine instances
  private cohomologyEngine: CohomologyEngine | null = null;
  private spectralEngine: SpectralEngine | null = null;
  private causalEngine: CausalEngine | null = null;
  private quantumEngine: QuantumEngine | null = null;
  private categoryEngine: CategoryEngine | null = null;
  private hottEngine: HottEngine | null = null;

  // Configuration
  private config: WasmBridgeConfig;

  constructor(config: WasmBridgeConfig = {}) {
    this.config = {
      wasmPath: config.wasmPath ?? DEFAULT_WASM_PATH,
      enableLogging: config.enableLogging ?? false,
      cacheSize: config.cacheSize ?? 100
    };
  }

  /**
   * Initialize the WASM bridge
   *
   * Loads the WASM module and creates engine instances.
   * Safe to call multiple times - only initializes once.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    await this.initPromise;
  }

  /**
   * Internal initialization logic
   */
  private async doInitialize(): Promise<void> {
    const startTime = performance.now();

    try {
      // Try to load WASM module
      await this.loadWasm(this.config.wasmPath);

      // Create engine instances with WASM module
      this.cohomologyEngine = new CohomologyEngine(this.wasmModule ?? undefined);
      this.spectralEngine = new SpectralEngine(this.wasmModule ?? undefined);
      this.causalEngine = new CausalEngine(this.wasmModule ?? undefined);
      this.quantumEngine = new QuantumEngine(this.wasmModule ?? undefined);
      this.categoryEngine = new CategoryEngine(this.wasmModule ?? undefined);
      this.hottEngine = new HottEngine(this.wasmModule ?? undefined);

      this.initialized = true;
      this.loadTime = performance.now() - startTime;

      if (this.config.enableLogging) {
        console.log(`[Prime Radiant] WASM bridge initialized in ${this.loadTime.toFixed(2)}ms`);
      }
    } catch (error) {
      // Fall back to pure JS engines if WASM loading fails
      if (this.config.enableLogging) {
        console.warn('[Prime Radiant] WASM loading failed, using pure JS fallback:', error);
      }

      this.wasmModule = null;
      this.cohomologyEngine = new CohomologyEngine();
      this.spectralEngine = new SpectralEngine();
      this.causalEngine = new CausalEngine();
      this.quantumEngine = new QuantumEngine();
      this.categoryEngine = new CategoryEngine();
      this.hottEngine = new HottEngine();

      this.initialized = true;
      this.loadTime = performance.now() - startTime;
    }
  }

  /**
   * Load WASM module from path
   *
   * Supports Node.js, browser, and web worker environments.
   */
  async loadWasm(wasmPath?: string): Promise<void> {
    const path = wasmPath ?? this.config.wasmPath ?? DEFAULT_WASM_PATH;

    try {
      if (isNode) {
        await this.loadWasmNode(path);
      } else if (isBrowser || isWebWorker) {
        await this.loadWasmBrowser(path);
      } else {
        throw new Error('Unsupported environment for WASM loading');
      }
    } catch (error) {
      if (this.config.enableLogging) {
        console.warn(`[Prime Radiant] Failed to load WASM from ${path}:`, error);
      }
      throw error;
    }
  }

  /**
   * Load WASM in Node.js environment
   */
  private async loadWasmNode(wasmPath: string): Promise<void> {
    try {
      // Try dynamic import of the WASM package
      // Specifier behind a string var so tsc doesn't statically resolve this
      // optionalDependency at build time (TS2307 when it isn't installed).
      const pkg: string = 'prime-radiant-advanced-wasm';
      const primeRadiant = await import(pkg);

      // Initialize the module
      if (typeof primeRadiant.default === 'function') {
        await primeRadiant.default();
      }

      // Access the module exports
      this.wasmModule = primeRadiant as unknown as WasmModule;
      this.bundleSize = 92 * 1024; // ~92KB

      if (this.config.enableLogging) {
        console.log('[Prime Radiant] WASM module loaded via npm package');
      }
    } catch {
      // Try loading from file path
      const fs = await import('fs');
      const path = await import('path');

      let resolvedPath = wasmPath;

      // Try to resolve path
      if (!path.default.isAbsolute(wasmPath)) {
        // Try node_modules
        const nodeModulesPath = path.default.join(
          process.cwd(),
          'node_modules',
          wasmPath
        );
        if (fs.existsSync(nodeModulesPath)) {
          resolvedPath = nodeModulesPath;
        }
      }

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`WASM file not found: ${resolvedPath}`);
      }

      const wasmBuffer = fs.readFileSync(resolvedPath);
      this.bundleSize = wasmBuffer.length;

      const wasmModule = await WebAssembly.compile(wasmBuffer);
      const importObject = this.createImportObject();
      const instance = await WebAssembly.instantiate(wasmModule, importObject as WebAssembly.Imports);

      this.wasmModule = instance.exports as unknown as WasmModule;

      if (this.config.enableLogging) {
        console.log(`[Prime Radiant] WASM module loaded from ${resolvedPath}`);
      }
    }
  }

  /**
   * Load WASM in browser environment
   */
  private async loadWasmBrowser(wasmPath: string): Promise<void> {
    try {
      // Try dynamic import first (bundler support)
      // Specifier behind a string var so tsc doesn't statically resolve this
      // optionalDependency at build time (TS2307 when it isn't installed).
      const pkg: string = 'prime-radiant-advanced-wasm';
      const primeRadiant = await import(pkg);

      if (typeof primeRadiant.default === 'function') {
        await primeRadiant.default();
      }

      this.wasmModule = primeRadiant as unknown as WasmModule;
      this.bundleSize = 92 * 1024;

      if (this.config.enableLogging) {
        console.log('[Prime Radiant] WASM module loaded via bundler');
      }
    } catch {
      // Fall back to fetch
      const response = await fetch(wasmPath);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status}`);
      }

      const wasmBuffer = await response.arrayBuffer();
      this.bundleSize = wasmBuffer.byteLength;

      const importObject = this.createImportObject();
      if (typeof WebAssembly.instantiateStreaming === 'function') {
        // Streaming compilation (faster)
        const result = await WebAssembly.instantiateStreaming(
          fetch(wasmPath),
          importObject
        );
        this.wasmModule = result.instance.exports as unknown as WasmModule;
      } else {
        // Standard compilation
        const wasmModule = await WebAssembly.compile(wasmBuffer);
        const instance = await WebAssembly.instantiate(wasmModule, importObject as WebAssembly.Imports);
        this.wasmModule = instance.exports as unknown as WasmModule;
      }

      if (this.config.enableLogging) {
        console.log(`[Prime Radiant] WASM module loaded from ${wasmPath}`);
      }
    }
  }

  /**
   * Create WASM import object for initialization
   */
  private createImportObject(): Record<string, Record<string, WebAssembly.ImportValue>> {
    return {
      env: {
        // Memory
        memory: new WebAssembly.Memory({ initial: 256 }),

        // Console logging
        console_log: (ptr: number, len: number) => {
          if (this.config.enableLogging) {
            console.log('[WASM]', this.readString(ptr, len));
          }
        },
        console_error: (ptr: number, len: number) => {
          console.error('[WASM]', this.readString(ptr, len));
        },

        // Math functions
        sin: Math.sin,
        cos: Math.cos,
        sqrt: Math.sqrt,
        exp: Math.exp,
        log: Math.log,
        pow: Math.pow,
        random: Math.random,

        // Abort handler
        abort: () => {
          throw new Error('WASM abort called');
        }
      }
    };
  }

  /**
   * Read string from WASM memory
   */
  private readString(ptr: number, len: number): string {
    if (!this.wasmModule?.memory) return '';

    const buffer = new Uint8Array(this.wasmModule.memory.buffer, ptr, len);
    return new TextDecoder().decode(buffer);
  }

  // ============================================================================
  // Engine Accessors
  // ============================================================================

  /**
   * Get the Cohomology Engine for coherence checking
   *
   * @returns CohomologyEngine instance
   * @throws Error if not initialized
   */
  getCohomologyEngine(): ICohomologyEngine {
    this.ensureInitialized();
    return this.cohomologyEngine!;
  }

  /**
   * Get the Spectral Engine for stability analysis
   *
   * @returns SpectralEngine instance
   * @throws Error if not initialized
   */
  getSpectralEngine(): ISpectralEngine {
    this.ensureInitialized();
    return this.spectralEngine!;
  }

  /**
   * Get the Causal Engine for do-calculus inference
   *
   * @returns CausalEngine instance
   * @throws Error if not initialized
   */
  getCausalEngine(): ICausalEngine {
    this.ensureInitialized();
    return this.causalEngine!;
  }

  /**
   * Get the Quantum Engine for topology operations
   *
   * @returns QuantumEngine instance
   * @throws Error if not initialized
   */
  getQuantumEngine(): IQuantumEngine {
    this.ensureInitialized();
    return this.quantumEngine!;
  }

  /**
   * Get the Category Engine for functor operations
   *
   * @returns CategoryEngine instance
   * @throws Error if not initialized
   */
  getCategoryEngine(): ICategoryEngine {
    this.ensureInitialized();
    return this.categoryEngine!;
  }

  /**
   * Get the HoTT Engine for type theory operations
   *
   * @returns HottEngine instance
   * @throws Error if not initialized
   */
  getHottEngine(): IHottEngine {
    this.ensureInitialized();
    return this.hottEngine!;
  }

  // ============================================================================
  // Status and Lifecycle
  // ============================================================================

  /**
   * Get current bridge status
   */
  getStatus(): WasmStatus {
    return {
      initialized: this.initialized,
      loadTime: this.loadTime,
      bundleSize: this.bundleSize,
      engines: {
        cohomology: this.cohomologyEngine !== null,
        spectral: this.spectralEngine !== null,
        causal: this.causalEngine !== null,
        quantum: this.quantumEngine !== null,
        category: this.categoryEngine !== null,
        hott: this.hottEngine !== null
      }
    };
  }

  /**
   * Check if WASM is loaded (vs pure JS fallback)
   */
  isWasmLoaded(): boolean {
    return this.wasmModule !== null;
  }

  /**
   * Check if bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.wasmModule = null;
    this.cohomologyEngine = null;
    this.spectralEngine = null;
    this.causalEngine = null;
    this.quantumEngine = null;
    this.categoryEngine = null;
    this.hottEngine = null;
    this.initialized = false;
    this.initPromise = null;

    if (this.config.enableLogging) {
      console.log('[Prime Radiant] WASM bridge disposed');
    }
  }

  /**
   * Ensure bridge is initialized before use
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'WasmBridge not initialized. Call initialize() first or await the initialization promise.'
      );
    }
  }
}

/**
 * Create a pre-configured WASM bridge instance
 */
export function createWasmBridge(config?: WasmBridgeConfig): WasmBridge {
  return new WasmBridge(config);
}

/**
 * Create and initialize a WASM bridge
 */
export async function initializeWasmBridge(config?: WasmBridgeConfig): Promise<WasmBridge> {
  const bridge = new WasmBridge(config);
  await bridge.initialize();
  return bridge;
}

// Default export
export default WasmBridge;
