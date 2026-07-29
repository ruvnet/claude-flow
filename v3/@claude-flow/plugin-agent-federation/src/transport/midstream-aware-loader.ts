/**
 * Midstream-aware federation transport loader (ADR-120, Step 2).
 *
 * Extends the agentic-flow `loadQuicTransport` loader pattern with a
 * preferred branch that probes `midstreamer` first. When `midstreamer`
 * ships real QUIC (currently the WASM build is a counter-tracking
 * stub per ADR-119), this loader picks it up automatically without
 * any change to consumer plugins.
 *
 * Resolution order:
 *
 *   1. If `MIDSTREAMER_QUIC_NATIVE=1` AND the `midstreamer` module
 *      exposes a real `QuicMultistream`-derived `AgentTransport`,
 *      use it. (Today: probes fail closed and we fall through.)
 *
 *   2. Otherwise: defer to agentic-flow's existing loader, which
 *      itself respects `AGENTIC_FLOW_QUIC_NATIVE=1` (ADR-108) and
 *      falls back to WebSocket (ADR-104) otherwise.
 *
 * The loader is opt-in: callers must explicitly invoke
 * `loadFederationTransport()` instead of `loadQuicTransport()`.
 * Behavior is identical to `loadQuicTransport()` until upstream
 * `midstreamer` ships its real QUIC build AND the operator sets the
 * env flag — so this change is safe to land before any of that
 * happens.
 *
 * Re-exports the `AgentTransport` / `AgentMessage` / `QuicTransportConfig`
 * surface from agentic-flow so consumers only import from one place.
 */

// Minimal locally-declared type surface. Previously imported as
// `import type { … } from 'agentic-flow/transport/loader'`, but that
// subpath is not part of agentic-flow's published `exports` map — a
// strict `moduleResolution: bundler` build or an external verifier
// that literally does `import 'agentic-flow/transport/loader'` fails
// with `ERR_MODULE_NOT_FOUND` (issue #2578). agentic-flow remains an
// OPTIONAL peer dep, so the loader must compile without touching its
// exports map at all.
export interface AgentMessage {
  id: string;
  type: 'task' | 'result' | 'status' | 'coordination' | 'heartbeat' | string;
  payload: unknown;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface AgentTransport {
  send: (address: string, message: AgentMessage) => Promise<void>;
  onMessage: (handler: (address: string, message: AgentMessage) => void) => void;
  listen?: (port: number, host?: string) => Promise<void>;
  close?: () => Promise<void> | void;
  [key: string]: unknown;
}
export interface QuicTransportConfig {
  port?: number;
  host?: string;
  serverName?: string;
  [key: string]: unknown;
}

function isCompatibleTransport(
  value: unknown,
  requireListen = false,
): value is AgentTransport {
  if (!value || typeof value !== 'object') return false;
  const transport = value as Partial<AgentTransport>;
  return (
    typeof transport.send === 'function' &&
    typeof transport.onMessage === 'function' &&
    (!requireListen || typeof transport.listen === 'function')
  );
}

/**
 * Lazy loader for agentic-flow's `loadQuicTransport`. Returns `null`
 * when `agentic-flow` is not installed — callers must then fall back
 * to the midstream-first path or surface a clear error.
 *
 * Per ADR-120 + issue #1949, `agentic-flow` is now an **optional**
 * peer dependency. Operators who only want the midstream-native
 * transport (via `MIDSTREAMER_QUIC_NATIVE=1`) can omit it to avoid
 * the deep `koa-router` → `cookies@0.9.1` transitive chain that
 * hardened npm registries reject.
 */
async function loadAgenticFlowQuicTransport(
  config?: QuicTransportConfig,
): Promise<AgentTransport | null> {
  // Direct dynamic `import()` (not the `new Function` trick) so
  // test frameworks like vitest can intercept via `vi.mock`. The
  // try/catch makes the module-not-found case a clean `null` so the
  // caller falls back gracefully — agentic-flow is now an optional
  // peer dependency.
  let mod: {
    loadQuicTransport?: (c?: QuicTransportConfig) => Promise<AgentTransport>;
    default?: {
      loadQuicTransport?: (c?: QuicTransportConfig) => Promise<AgentTransport>;
    };
  };
  try {
    // Cast through `unknown` because upstream's exported AgentTransport /
    // AgentMessage carry a richer surface (InboundMessageHandler with an
    // options bag, extra fields) that intentionally differs from our
    // locally-declared minimal shim. The shim exists so the plugin can
    // compile without importing agentic-flow's exports map at all
    // (#2578). Downstream code (`plugin.ts`) uses our shim types.
    mod = (await import('agentic-flow/transport/loader')) as unknown as typeof mod;
  } catch {
    return null;
  }
  const fn =
    typeof mod.loadQuicTransport === 'function'
      ? mod.loadQuicTransport
      : mod.default?.loadQuicTransport;
  if (typeof fn !== 'function') {
    return null;
  }
  try {
    const transport = await fn(config);
    return isCompatibleTransport(transport, typeof config?.port === 'number')
      ? transport
      : null;
  } catch {
    return null;
  }
}

/** Result envelope describing which backend the loader picked. */
export interface LoadedFederationTransport {
  /** The live transport. Send/receive against this. */
  transport: AgentTransport;
  /** Which loader branch resolved. Useful for logs/metrics. */
  source: 'midstreamer-native' | 'agentic-flow-loader' | 'websocket-fallback';
  /** Free-form note when a probe failed (helps explain a fallback). */
  fallbackReason?: string;
}

type WebSocketLike = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  send: (data: string, cb?: (err?: Error) => void) => void;
  close: () => void;
};

type WebSocketServerLike = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  close: (cb?: () => void) => void;
};

/**
 * Plugin-owned ADR-104 WebSocket fallback. This closes issue #2618's
 * failure mode: current `agentic-flow` releases do not export
 * `agentic-flow/transport/loader`, so the federation plugin must not
 * depend on that subpath for its baseline wire transport.
 */
class WebSocketFallbackTransport implements AgentTransport {
  [key: string]: unknown;

  private handlers: Array<(address: string, message: AgentMessage) => void> = [];
  private server: WebSocketServerLike | null = null;
  private sockets = new Set<WebSocketLike>();

  constructor(private readonly config: QuicTransportConfig = {}) {}

  async send(address: string, message: AgentMessage): Promise<void> {
    const { default: WebSocket } = await import('ws');
    const url = address.includes('://') ? address : `ws://${address}`;
    const socket = new WebSocket(url) as WebSocketLike;

    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => {
        socket.send(JSON.stringify(message), (err?: Error) => {
          socket.close();
          if (err) reject(err);
          else resolve();
        });
      });
      socket.on('error', (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
    });
  }

  onMessage(handler: (address: string, message: AgentMessage) => void): void {
    this.handlers.push(handler);
  }

  async listen(port = Number(this.config.port ?? 0), host = String(this.config.host ?? '0.0.0.0')): Promise<void> {
    const { WebSocketServer } = await import('ws');
    const server = new WebSocketServer({ port, host }) as WebSocketServerLike;
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.on('listening', () => resolve());
      server.on('error', (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
      server.on('connection', (socket: unknown, request: unknown) => {
        const ws = socket as WebSocketLike;
        this.sockets.add(ws);
        const remoteAddress = ((request as { socket?: { remoteAddress?: string; remotePort?: number } })?.socket);
        const address = remoteAddress?.remoteAddress
          ? `${remoteAddress.remoteAddress}${remoteAddress.remotePort ? `:${remoteAddress.remotePort}` : ''}`
          : 'unknown';

        ws.on('message', (data: unknown) => {
          try {
            const raw = typeof data === 'string'
              ? data
              : Buffer.isBuffer(data)
                ? data.toString('utf8')
                : String(data);
            const message = JSON.parse(raw) as AgentMessage;
            for (const handler of this.handlers) handler(address, message);
          } catch {
            // Drop malformed frames. Signature/envelope validation happens
            // above this layer in inbound-dispatcher.
          }
        });
        ws.on('close', () => this.sockets.delete(ws));
      });
    });
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(resolve));
      this.server = null;
    }
  }
}

/**
 * Probe the `midstreamer` npm package for a real QUIC transport.
 * Returns `null` when the env flag is off, when the package isn't
 * installed, when the import surface doesn't match expectations, or
 * when the loaded module is detectably the WASM stub (per ADR-119
 * the current shipped build is a counter-tracking stub — `isNative()`
 * or `isStub()` probes are checked when available).
 *
 * The function never throws — any failure becomes `null` so the
 * outer `loadFederationTransport` can transparently fall back.
 */
async function probeMidstreamerTransport(
  config?: QuicTransportConfig,
): Promise<{ transport: AgentTransport; reason?: string } | null> {
  if (process.env.MIDSTREAMER_QUIC_NATIVE !== '1') {
    return null;
  }

  let mod: unknown;
  try {
    // Lazy + indirect so bundlers don't try to resolve at compile time.
    // Prefer the `midstreamer/quic` sub-path (added in midstreamer@0.3.1
    // per upstream ruvnet/midstream#81) which exposes
    // `loadQuicTransport` directly without WASM init. Fall back to the
    // root `midstreamer` package for older versions that put the QUIC
    // surface on the default export.
    const dynamicImport: (s: string) => Promise<unknown> = new Function(
      's',
      'return import(s)',
    ) as (s: string) => Promise<unknown>;
    try {
      mod = await dynamicImport('midstreamer/quic');
    } catch {
      mod = await dynamicImport('midstreamer');
    }
  } catch {
    return null;
  }

  const candidate = mod as {
    loadQuicTransport?: (c?: QuicTransportConfig) => Promise<AgentTransport>;
    isNative?: () => boolean;
    isStub?: () => boolean;
    default?: {
      loadQuicTransport?: (c?: QuicTransportConfig) => Promise<AgentTransport>;
      isNative?: () => boolean;
      isStub?: () => boolean;
    };
  };

  // CommonJS sub-path exposes its API via `module.exports = {...};
  // module.exports.default = module.exports;` — so we also accept the
  // `.default` form. ESM imports flatten the named exports directly.
  const surface = (typeof candidate.loadQuicTransport === 'function'
    ? candidate
    : candidate.default) as {
    loadQuicTransport?: (c?: QuicTransportConfig) => Promise<AgentTransport>;
    isNative?: () => boolean;
    isStub?: () => boolean;
  } | undefined;
  if (!surface) {
    return null;
  }

  // Refuse to use the WASM stub. ADR-119 documented the previous
  // QuicMultistream as a counter-tracking stub with no real UDP, TLS,
  // or protocol — using it would silently downgrade the federation
  // path. midstreamer@0.3.1+ ships a real QUIC transport via
  // `midstreamer/quic` (ADR-120, Step 1 — upstream PR ruvnet/midstream#81)
  // and reports `isNative() === true`. Older versions either expose
  // `isStub()` returning true or omit both probes.
  if (typeof surface.isStub === 'function' && surface.isStub()) {
    return { transport: null as unknown as AgentTransport, reason: 'midstreamer module reports isStub() === true; refusing to bind a stub QUIC backend (ADR-119)' };
  }

  if (typeof surface.loadQuicTransport !== 'function') {
    return null;
  }

  if (typeof surface.isNative === 'function' && !surface.isNative()) {
    return null;
  }

  try {
    const transport = await surface.loadQuicTransport(config);
    return isCompatibleTransport(transport, typeof config?.port === 'number')
      ? { transport }
      : {
          transport: null as unknown as AgentTransport,
          reason: 'midstreamer transport does not implement the federation send/onMessage/listen contract',
        };
  } catch (err) {
    return {
      transport: null as unknown as AgentTransport,
      reason: `midstreamer.loadQuicTransport failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Top-level loader for federation transport. Identical signature to
 * agentic-flow's `loadQuicTransport`, but with the midstreamer-first
 * preference. Use this from `plugins/ruflo-federation` in place of
 * the bare `loadQuicTransport`.
 *
 * Failure mode: if midstreamer is requested but rejects (stub, init
 * error, missing package), this function falls through to the
 * agentic-flow loader. If current agentic-flow does not export its
 * historical loader subpath, the plugin-owned WebSocket fallback is
 * used directly (ADR-104, #2618).
 */
export async function loadFederationTransport(
  config?: QuicTransportConfig,
): Promise<LoadedFederationTransport> {
  const probe = await probeMidstreamerTransport(config);
  if (probe && probe.transport) {
    return { transport: probe.transport, source: 'midstreamer-native' };
  }

  const transport = await loadAgenticFlowQuicTransport(config);
  if (transport) {
    return {
      transport,
      source: 'agentic-flow-loader',
      fallbackReason: probe?.reason,
    };
  }

  return {
    transport: new WebSocketFallbackTransport(config),
    source: 'websocket-fallback',
    fallbackReason: probe?.reason ?? 'agentic-flow transport loader unavailable; using plugin-owned WebSocket fallback',
  };
}
