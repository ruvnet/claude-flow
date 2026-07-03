/**
 * A2A well-known Agent Card endpoint (A2A 1.0 §8.2 discovery + §8.6 caching).
 *
 * Serves `GET /.well-known/agent-card.json` from a minimal `node:http`
 * server. Security posture follows ADR-166 (mcp-bridge unauthenticated-RCE
 * remediation): binds 127.0.0.1 by default and REFUSES a non-loopback bind
 * unless the caller passes `allowNonLoopback: true` explicitly. The endpoint
 * is read-only (GET/HEAD on one exact path), exposes only the public card,
 * and is entirely opt-in — nothing here weakens the federation transport's
 * existing bind or auth behavior.
 */

import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { A2A_WELL_KNOWN_PATH, type A2AAgentCard } from './agent-card.js';

export interface AgentCardServerOptions {
  /** Card supplier — re-invoked per request so a late-published manifest is picked up. */
  readonly getCard: () => A2AAgentCard | null;
  readonly port: number;
  /** Bind host. Default 127.0.0.1 (ADR-166 posture). */
  readonly host?: string;
  /** Serve path. Default A2A_WELL_KNOWN_PATH. */
  readonly path?: string;
  /**
   * Explicit opt-in required to bind anything other than loopback. Without
   * it a non-loopback host is rejected at start (fail-closed).
   */
  readonly allowNonLoopback?: boolean;
  /** Cache-Control max-age seconds (spec §8.6.1). Default 300. */
  readonly cacheMaxAgeSeconds?: number;
}

export interface AgentCardServerHandle {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host.startsWith('127.');
}

/**
 * Start the well-known Agent Card HTTP endpoint.
 *
 * Responses:
 *   GET/HEAD <path>  → 200 application/json (+ Cache-Control, ETag per §8.6)
 *                      or 503 when no card is available yet
 *   other method     → 405
 *   other path       → 404
 */
export function startAgentCardServer(
  options: AgentCardServerOptions,
): Promise<AgentCardServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const path = options.path ?? A2A_WELL_KNOWN_PATH;
  const maxAge = options.cacheMaxAgeSeconds ?? 300;

  if (!isLoopbackHost(host) && options.allowNonLoopback !== true) {
    return Promise.reject(new Error(
      `A2A agent-card server: refusing non-loopback bind ${host} without allowNonLoopback: true (ADR-166)`,
    ));
  }

  const server: Server = createServer((req, res) => {
    const reqPath = (req.url ?? '').split('?')[0];
    if (reqPath !== path) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', agentCardPath: path }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }
    const card = options.getCard();
    if (!card) {
      res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '5' });
      res.end(JSON.stringify({ error: 'agent_card_not_ready' }));
      return;
    }
    const body = JSON.stringify(card, null, 2);
    const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${maxAge}`,
      etag,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(options.port, host, () => {
      server.removeListener('error', rejectPromise);
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr !== null ? addr.port : options.port;
      resolvePromise({
        url: `http://${host}:${boundPort}${path}`,
        host,
        port: boundPort,
        close: () =>
          new Promise<void>((res2, rej2) => {
            server.close((err) => (err ? rej2(err) : res2()));
          }),
      });
    });
  });
}
