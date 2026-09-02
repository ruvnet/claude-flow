/**
 * Runtime Environment Detection
 * Cross-platform detection and compatibility layer for Node.js and Deno
 */

// Runtime detection
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
const isDeno = typeof Deno !== 'undefined';

// Environment-specific imports
let runtime;
let stdin, stdout, stderr;
let TextEncoder, TextDecoder;
let exit, pid, addSignalListener;

if (isDeno) {
  // Deno environment
  runtime = 'deno';
  stdin = Deno.stdin;
  stdout = Deno.stdout;
  stderr = Deno.stderr;
  TextEncoder = globalThis.TextEncoder;
  TextDecoder = globalThis.TextDecoder;
  exit = Deno.exit;
  pid = Deno.pid;
  addSignalListener = Deno.addSignalListener;
} else if (isNode) {
  // Node.js environment
  runtime = 'node';
  stdin = process.stdin;
  stdout = process.stdout;
  stderr = process.stderr;
  TextEncoder = globalThis.TextEncoder || require('util').TextEncoder;
  TextDecoder = globalThis.TextDecoder || require('util').TextDecoder;
  exit = process.exit;
  pid = process.pid;
  addSignalListener = (signal, handler) => {
    process.on(signal, handler);
  };
} else {
  throw new Error('Unsupported runtime environment');
}

/**
 * Cross-platform terminal I/O layer
 */
export class UnifiedTerminalIO {
  constructor() {
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
    this.runtime = runtime;
  }

  /**
   * Write to stdout
   */
  async write(data) {
    if (typeof data === 'string') {
      data = this.encoder.encode(data);
    }

    if (runtime === 'deno') {
      await stdout.write(data);
    } else {
      return new Promise((resolve) => {
        stdout.write(data, resolve);
      });
    }
  }

  /**
   * Read from stdin
   */
  async read(buffer) {
    if (runtime === 'deno') {
      return await stdin.read(buffer);
    } else {
      return new Promise((resolve) => {
        let data = '';
        const onData = (chunk) => {
          data += chunk;
          if (data.includes('\n')) {
            stdin.removeListener('data', onData);
            const encoded = this.encoder.encode(data);
            const bytesToCopy = Math.min(encoded.length, buffer.length);
            buffer.set(encoded.slice(0, bytesToCopy));
            resolve(bytesToCopy);
          }
        };

        // Only set raw mode if available (terminal environments)
        if (stdin.setRawMode && typeof stdin.setRawMode === 'function') {
          try {
            stdin.setRawMode(true);
          } catch (err) {
            // Ignore errors if not in a TTY
          }
        }

        if (stdin.resume && typeof stdin.resume === 'function') {
          stdin.resume();
        }

        stdin.on('data', onData);
      });
    }
  }

  /**
   * Set up signal handlers
   */
  onSignal(signal, handler) {
    if (runtime === 'deno') {
      addSignalListener(signal, handler);
    } else {
      process.on(signal, handler);
    }
  }

  /**
   * Exit the process
   */
  exit(code = 0) {
    exit(code);
  }

  /**
   * Get process ID
   */
  getPid() {
    return pid;
  }

  /**
   * Set raw mode for stdin (Node.js only)
   */
  setRawMode(enabled) {
    if (runtime === 'node' && stdin.setRawMode && typeof stdin.setRawMode === 'function') {
      try {
        stdin.setRawMode(enabled);
      } catch (err) {
        // Ignore errors if not in a TTY
      }
    }
  }

  /**
   * Resume stdin (Node.js only)
   */
  resume() {
    if (runtime === 'node' && stdin.resume) {
      stdin.resume();
    }
  }

  /**
   * Pause stdin (Node.js only)
   */
  pause() {
    if (runtime === 'node' && stdin.pause) {
      stdin.pause();
    }
  }
}

/**
 * Environment detection utilities
 */
export const RuntimeDetector = {
  isNode: () => isNode,
  isDeno: () => isDeno,
  getRuntime: () => runtime,

  /**
   * Get platform-specific information
   */
  getPlatform: () => {
    if (runtime === 'deno') {
      return {
        os: Deno.build.os,
        arch: Deno.build.arch,
        target: Deno.build.target,
      };
    } else {
      return {
        os:
          process.platform === 'win32'
            ? 'windows'
            : process.platform === 'darwin'
              ? 'darwin'
              : process.platform === 'linux'
                ? 'linux'
                : process.platform,
        arch: process.arch,
        target: `${process.arch}-${process.platform}`,
      };
    }
  },

  /**
   * Check if API is available
   */
  hasAPI: (apiName) => {
    switch (apiName) {
      case 'deno':
        return isDeno;
      case 'node':
        return isNode;
      case 'fs':
        return runtime === 'node' || (runtime === 'deno' && typeof Deno.readFile !== 'undefined');
      case 'process':
        return runtime === 'node' || (runtime === 'deno' && typeof Deno.run !== 'undefined');
      default:
        return false;
    }
  },

  /**
   * Get environment variables
   */
  getEnv: (key) => {
    if (runtime === 'deno') {
      return process.env[key];
    } else {
      return process.env[key];
    }
  },

  /**
   * Set environment variables
   */
  setEnv: (key, value) => {
    if (runtime === 'deno') {
      process.env[key] = value;
    } else {
      process.env[key] = value;
    }
  },
};

/**
 * Cross-platform compatibility layer
 */
export const createCompatibilityLayer = () => {
  return {
    runtime,
    terminal: new UnifiedTerminalIO(),
    detector: RuntimeDetector,

    // Unified APIs
    TextEncoder,
    TextDecoder,

    // Platform info
    platform: RuntimeDetector.getPlatform(),

    // Environment
    getEnv: RuntimeDetector.getEnv,
    setEnv: RuntimeDetector.setEnv,

    // Process control
    exit,
    pid,

    // Graceful degradation helpers
    safeCall: async (fn, fallback = null) => {
      try {
        return await fn();
      } catch (error) {
        console.warn(`Runtime compatibility warning: ${error.message}`);
        return fallback;
      }
    },

    // Feature detection
    hasFeature: (feature) => {
      return RuntimeDetector.hasAPI(feature);
    },
  };
};

// Export the compatibility layer instance
export const compat = createCompatibilityLayer();

// Export runtime detection results
export { runtime, isNode, isDeno };
